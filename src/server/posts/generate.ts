// Text post generation (TASK-007, ADR-036): CGP + materials + effective rules → Claude (forced tool, zod-checked) →
// machine rule check → at most one automatic fix → ready | needs_review | failed. Every call is cost-capped and logged.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { checkText, checkThread, effectiveRules, type RuleLayer, type RuleSet, type Violation } from "@/lib/rules";
import { getBrandDetail, BrandError } from "../brands/service";
import type { Db } from "../db/client";
import { brandSources, modelRegistry, posts, usageLedger, type PostContent, type PostStatus } from "../db/schema";
import type { Storage } from "../files/storage";
import { costMicroUsd, worstCaseMicroUsd } from "../llm/cost";
import { reserve, release, settle, SpendCapError } from "../llm/spend";
import { LlmError, type LlmClient } from "../llm/types";
import { getPlatformRuleSet } from "../rules/repo";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { buildPostPrompt, MATERIALS_MAX_CHARS } from "./prompt";

export const MAX_OUTPUT_TOKENS = 2000;
/** Text materials larger than this are skipped (PDF/Office extraction is a later task). */
const MATERIAL_FILE_MAX = 1024 * 1024;

export class PostError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "ARCHIVED" | "NO_MODEL" | "BAD_STATE") {
    super(code);
  }
}

export const generateInput = z.object({
  brandId: z.string().min(1),
  channelId: z.string().min(1),
  brief: z.string().trim().min(3).max(2000),
});

const textOutput = z.object({ caption: z.string().trim().min(1).max(10_000), hashtags: z.array(z.string()).max(60), topic_summary: z.string().max(500) });
const threadOutput = z.object({ parts: z.array(z.string().trim().min(1).max(5000)).min(1).max(50), hashtags: z.array(z.string()).max(60), topic_summary: z.string().max(500) });

/** "#ai", "ai", "# AI tools" → "#ai", "#ai", "#AItools"; duplicates and empties dropped. */
export function normalizeHashtags(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const body = t.replace(/^#+/, "").replace(/\s+/g, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (body && !out.some((o) => o.toLowerCase() === `#${body}`.toLowerCase())) out.push(`#${body}`);
  }
  return out;
}

/** The text exactly as it will be posted: hashtags appended to the caption, or to the last thread part. */
export function composeContent(raw: { caption?: string; parts?: string[]; hashtags: string[] }): PostContent {
  const hashtags = normalizeHashtags(raw.hashtags);
  const tail = hashtags.length ? `\n\n${hashtags.join(" ")}` : "";
  if (raw.parts) {
    const parts = raw.parts.map((p) => p.trim());
    parts[parts.length - 1] += tail;
    return { caption: parts.join("\n\n"), parts, hashtags };
  }
  return { caption: `${raw.caption!.trim()}${tail}`, hashtags };
}

/** Same checks for generated and hand-edited posts. Threads: per-part lengths + content rules on the whole text. */
export function checkPost(c: PostContent, rules: RuleSet, cta: string[]): Violation[] {
  if (c.parts) {
    const contentRules: RuleSet = { ...rules, captionMax: undefined, visibleChars: undefined };
    return [...checkThread(c.parts, rules), ...checkText(c.caption, contentRules, cta).violations];
  }
  return checkText(c.caption, rules, cta).violations;
}

export async function rulesFor(db: Db, ctx: OrgContext, brandId: string, channelId: string) {
  const detail = await getBrandDetail(db, ctx, brandId).catch((e) => {
    if (e instanceof BrandError && e.code === "NOT_FOUND") throw new PostError("NOT_FOUND");
    throw e;
  });
  const channel = detail.channels.find((c) => c.id === channelId);
  if (!channel || !detail.profile) throw new PostError("NOT_FOUND");
  const platform = await getPlatformRuleSet(db, channel.platform);
  const p = detail.profile;
  const rules = effectiveRules(platform, channel.rules as RuleLayer, p.rules as RuleLayer);
  return { ...detail, channel, profile: p, rules, cta: p.rules.ctaPhrases ?? [] };
}

/** Plain-text materials (TXT/MD/CSV) of the brand, newest first, within the prompt budget. */
async function textMaterials(db: Db, storage: Storage, ctx: OrgContext, brandId: string) {
  const rows = (await forOrg(db, ctx)
    .select(brandSources, and(eq(brandSources.brandId, brandId), inArray(brandSources.kind, ["text", "csv"])))) as (typeof brandSources.$inferSelect)[];
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const out: { name: string; text: string }[] = [];
  let budget = MATERIALS_MAX_CHARS;
  for (const r of rows) {
    if (budget <= 0) break;
    if (r.sizeBytes > MATERIAL_FILE_MAX) continue;
    const text = new TextDecoder().decode(await storage.get(r.storageKey)).replace(/^﻿/, "");
    out.push({ name: r.filename, text: text.slice(0, budget) });
    budget -= Math.min(text.length, budget);
  }
  return out;
}

export type GenerateDeps = { llm: LlmClient; storage: Storage; now?: Date };

/** Any member (owner or editor) may generate. Returns the post id; the post row carries the outcome. */
export async function generatePost(db: Db, deps: GenerateDeps, ctx: OrgContext, input: z.input<typeof generateInput>): Promise<string> {
  const req = generateInput.parse(input);
  const r = await rulesFor(db, ctx, req.brandId, req.channelId);
  if (r.brand.archivedAt) throw new PostError("ARCHIVED");
  const [model] = await db.select().from(modelRegistry).where(and(eq(modelRegistry.kind, "text"), eq(modelRegistry.isDefault, true), eq(modelRegistry.enabled, true)));
  if (!model) throw new PostError("NO_MODEL");
  const materials = await textMaterials(db, deps.storage, ctx, req.brandId);

  const postId = crypto.randomUUID();
  const s = forOrg(db, ctx);
  await s.insert(posts, { id: postId, brandId: req.brandId, channelId: req.channelId, profileVersionId: r.profile.id, brief: req.brief, status: "generating", model: model.modelKey, createdBy: ctx.userId });
  const finish = (set: Partial<typeof posts.$inferInsert>) => s.update(posts, { ...set, updatedAt: new Date() }, eq(posts.id, postId));

  const thread = r.rules.threadPartMax !== undefined;
  let previous: { draft: unknown; violations: Violation[]; invalid?: boolean } | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = buildPostPrompt({
      brand: { name: r.brand.name },
      profile: { version: r.profile.version, cgp: r.profile.cgp, pillars: r.profile.pillars, ctaPhrases: r.cta },
      channel: { platform: r.channel.platform, handle: r.channel.handle, language: r.channel.language },
      rules: r.rules,
      materials,
      brief: req.brief,
      previous,
    });
    const chars = prompt.system.reduce((n, b) => n + b.text.length, 0) + prompt.user.length + JSON.stringify(prompt.tool).length;
    let ledgerId: string;
    try {
      ledgerId = await reserve(db, { orgId: ctx.orgId, brandId: req.brandId, postId, provider: model.provider, model: model.modelKey, estimate: worstCaseMicroUsd(chars, MAX_OUTPUT_TOKENS, model), now: deps.now });
    } catch (e) {
      if (e instanceof SpendCapError) {
        await finish({ status: "failed", error: "SPEND_CAP", fixAttempts: attempt });
        return postId;
      }
      throw e;
    }
    let out;
    try {
      out = await deps.llm.structured({ ...prompt, model: model.modelKey, maxTokens: MAX_OUTPUT_TOKENS });
    } catch (e) {
      await release(db, ledgerId);
      await finish({ status: "failed", error: e instanceof LlmError ? e.code : "PROVIDER", fixAttempts: attempt });
      return postId;
    }
    await settle(db, ledgerId, out.usage, costMicroUsd(out.usage, model));

    const parsed = (thread ? threadOutput : textOutput).safeParse(out.input);
    if (!parsed.success) {
      if (attempt === 0) { previous = { draft: out.input, violations: [], invalid: true }; continue; }
      await finish({ status: "failed", error: "INVALID_OUTPUT", fixAttempts: attempt });
      return postId;
    }
    const content = composeContent(parsed.data);
    const violations = checkPost(content, r.rules, r.cta);
    if (violations.length && attempt === 0) { previous = { draft: parsed.data, violations }; continue; }
    await finish({ status: violations.length ? "needs_review" : "ready", content, topicSummary: parsed.data.topic_summary, ruleFailures: violations, fixAttempts: attempt, error: null });
    return postId;
  }
  return postId; // unreachable: the second attempt always finishes
}

async function ownPost(db: Db, ctx: OrgContext, postId: string) {
  const [p] = (await forOrg(db, ctx).select(posts, eq(posts.id, postId))) as (typeof posts.$inferSelect)[];
  if (!p) throw new PostError("NOT_FOUND");
  return p;
}

const editable: PostStatus[] = ["ready", "needs_review", "approved"];

/** Hand edit by any member: re-checked with the same rules; the result decides ready vs needs_review. */
export async function editPost(db: Db, ctx: OrgContext, postId: string, input: { caption?: string; parts?: string[] }) {
  const p = await ownPost(db, ctx, postId);
  if (!editable.includes(p.status) || !p.channelId) throw new PostError("BAD_STATE");
  const r = await rulesFor(db, ctx, p.brandId, p.channelId);
  const body = z.object({ caption: z.string().trim().min(1).max(10_000).optional(), parts: z.array(z.string().trim().min(1).max(5000)).min(1).max(50).optional() }).strict().parse(input);
  // Hand edits contain the hashtags inline; they are counted from the text itself.
  const content: PostContent = body.parts ? { caption: body.parts.join("\n\n"), parts: body.parts, hashtags: [] } : { caption: body.caption ?? "", hashtags: [] };
  const violations = checkPost(content, r.rules, r.cta);
  await forOrg(db, ctx).update(posts, { content, ruleFailures: violations, status: violations.length ? "needs_review" : "ready", updatedAt: new Date() }, eq(posts.id, postId));
  return violations;
}

const transitions: Partial<Record<PostStatus, PostStatus[]>> = {
  ready: ["approved", "skipped"],
  needs_review: ["approved", "skipped"],
  approved: ["published", "skipped", "ready"],
  published: ["approved"],
  skipped: ["ready"],
  failed: ["skipped"],
};

/** Status moves a person makes (approve, mark published, skip). Approving a post with failures is an explicit override. */
export async function setPostStatus(db: Db, ctx: OrgContext, postId: string, to: PostStatus) {
  const p = await ownPost(db, ctx, postId);
  if (!transitions[p.status]?.includes(to)) throw new PostError("BAD_STATE");
  await forOrg(db, ctx).update(posts, { status: to, updatedAt: new Date() }, eq(posts.id, postId));
}

export async function listPosts(db: Db, ctx: OrgContext, brandId: string, limit = 50) {
  return db.select().from(posts).where(and(eq(posts.orgId, ctx.orgId), eq(posts.brandId, brandId))).orderBy(desc(posts.createdAt)).limit(limit);
}

export async function getPost(db: Db, ctx: OrgContext, postId: string) {
  return ownPost(db, ctx, postId);
}

/** Total provider cost of a post (all attempts), micro-USD. */
export async function postCost(db: Db, ctx: OrgContext, postId: string): Promise<bigint> {
  const [r] = await db
    .select({ s: sql<string>`coalesce(sum(${usageLedger.costMicroUsd}), 0)::text` })
    .from(usageLedger)
    .where(and(eq(usageLedger.orgId, ctx.orgId), eq(usageLedger.postId, postId)));
  return BigInt(r.s);
}
