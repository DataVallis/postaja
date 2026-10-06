// Text post generation (TASK-007, ADR-036): CGP + materials + effective rules → Claude (forced tool, zod-checked) →
// machine rule check → at most one automatic fix → ready | needs_review | failed. Every call is cost-capped and logged.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { checkText, checkThread, effectiveRules, type RuleLayer, type RuleSet, type Violation } from "@/lib/rules";
import { extractPendingSources } from "../brands/files";
import { getBrandDetail, BrandError } from "../brands/service";
import type { Db } from "../db/client";
import { brandSources, modelRegistry, posts, usageLedger, type PostContent, type PostStatus } from "../db/schema";
import type { Storage } from "../files/storage";
import { costMicroUsd, worstCaseMicroUsd } from "../llm/cost";
import { textModelFor } from "../llm/call";
import { reserve, release, settle, SpendCapError } from "../llm/spend";
import { LlmError, type LlmClient } from "../llm/types";
import { getPlatformRuleSet } from "../rules/repo";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { buildPostPrompt, MATERIALS_MAX_CHARS } from "./prompt";
import { selectMaterials } from "./retrieve";

export const MAX_OUTPUT_TOKENS = 2000;

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

/**
 * The brand's knowledge base for this request (TASK-009, ADR-039): text of every source (PDF, Word, Excel, PowerPoint,
 * TXT/MD/CSV), read at upload; older uploads are read now. All of it when it fits, else the passages that match the brief.
 */
export async function materialsFor(db: Db, storage: Storage, ctx: OrgContext, brandId: string, brief: string) {
  await extractPendingSources(db, storage, ctx, brandId);
  const rows = await db
    .select({ name: brandSources.filename, text: sql<string>`${brandSources.extract}->>'text'`, createdAt: brandSources.createdAt })
    .from(brandSources)
    .where(and(eq(brandSources.orgId, ctx.orgId), eq(brandSources.brandId, brandId), eq(brandSources.status, "extracted")))
    .orderBy(desc(brandSources.createdAt));
  return selectMaterials(rows.filter((r) => r.text).map((r) => ({ name: r.name, text: r.text })), brief, MATERIALS_MAX_CHARS);
}

export type GenerateDeps = { llm: LlmClient; storage: Storage; now?: Date };

type Model = typeof modelRegistry.$inferSelect;

/** The brand's chosen Claude model, else the platform default (TASK-017 follow-up). */
async function defaultModel(db: Db, brandId: string): Promise<Model> {
  try {
    return await textModelFor(db, brandId);
  } catch {
    throw new PostError("NO_MODEL");
  }
}

/**
 * The writing loop (ADR-036) for a post row that is already "generating": prompt → Claude → schema → rule check →
 * at most one automatic fix → ready | needs_review | failed. Every call is reserved against the spend cap.
 */
async function writeInto(db: Db, deps: GenerateDeps, ctx: OrgContext, postId: string, r: Awaited<ReturnType<typeof rulesFor>>, model: Model, brief: string) {
  const materials = await materialsFor(db, deps.storage, ctx, r.brand.id, brief);
  const s = forOrg(db, ctx);
  const finish = (set: Partial<typeof posts.$inferInsert>) => s.update(posts, { ...set, model: model.modelKey, updatedAt: new Date() }, eq(posts.id, postId));
  const thread = r.rules.threadPartMax !== undefined;
  let previous: { draft: unknown; violations: Violation[]; invalid?: boolean } | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = buildPostPrompt({
      brand: { name: r.brand.name },
      profile: { version: r.profile.version, cgp: r.profile.cgp, pillars: r.profile.pillars, ctaPhrases: r.cta },
      channel: { platform: r.channel.platform, handle: r.channel.handle, language: r.channel.language },
      rules: r.rules,
      materials,
      brief,
      previous,
    });
    const chars = prompt.system.reduce((n, b) => n + b.text.length, 0) + prompt.user.length + JSON.stringify(prompt.tool).length;
    let ledgerId: string;
    try {
      ledgerId = await reserve(db, { orgId: ctx.orgId, brandId: r.brand.id, postId, provider: model.provider, model: model.modelKey, estimate: worstCaseMicroUsd(chars, MAX_OUTPUT_TOKENS, model), now: deps.now });
    } catch (e) {
      if (e instanceof SpendCapError) {
        await finish({ status: "failed", error: "SPEND_CAP", fixAttempts: attempt });
        return;
      }
      throw e;
    }
    let out;
    try {
      out = await deps.llm.structured({ ...prompt, model: model.modelKey, maxTokens: MAX_OUTPUT_TOKENS });
    } catch (e) {
      await release(db, ledgerId);
      await finish({ status: "failed", error: e instanceof LlmError ? e.code : "PROVIDER", fixAttempts: attempt });
      return;
    }
    await settle(db, ledgerId, out.usage, costMicroUsd(out.usage, model));

    const parsed = (thread ? threadOutput : textOutput).safeParse(out.input);
    if (!parsed.success) {
      if (attempt === 0) { previous = { draft: out.input, violations: [], invalid: true }; continue; }
      await finish({ status: "failed", error: "INVALID_OUTPUT", fixAttempts: attempt });
      return;
    }
    const content = composeContent(parsed.data);
    const violations = checkPost(content, r.rules, r.cta);
    if (violations.length && attempt === 0) { previous = { draft: parsed.data, violations }; continue; }
    await finish({ status: violations.length ? "needs_review" : "ready", content, topicSummary: parsed.data.topic_summary, ruleFailures: violations, fixAttempts: attempt, error: null });
    return;
  }
}

/** Any member (owner or editor) may generate. Returns the post id; the post row carries the outcome. */
export async function generatePost(db: Db, deps: GenerateDeps, ctx: OrgContext, input: z.input<typeof generateInput>): Promise<string> {
  const req = generateInput.parse(input);
  const r = await rulesFor(db, ctx, req.brandId, req.channelId);
  if (r.brand.archivedAt) throw new PostError("ARCHIVED");
  const model = await defaultModel(db, req.brandId);
  const postId = crypto.randomUUID();
  await forOrg(db, ctx).insert(posts, { id: postId, brandId: req.brandId, channelId: req.channelId, profileVersionId: r.profile.id, brief: req.brief, status: "generating", model: model.modelKey, createdBy: ctx.userId });
  await writeInto(db, deps, ctx, postId, r, model, req.brief);
  return postId;
}

/**
 * The request Postaja writes a planned post from (TASK-014): the plan's own words — topic, format, slides, CTA,
 * link, first comment, audience, notes — never invented. The image prompt is context only.
 */
export function planBrief(p: Pick<typeof posts.$inferSelect, "brief" | "format" | "plan" | "scheduledOn">): string {
  const pl = p.plan ?? {};
  const lines = [
    `Topic: ${pl.topic ?? p.brief}`,
    `Format: ${p.format}${pl.slideCount ? ` (${pl.slideCount} slides)` : ""}. Write the post text (caption) only.`,
    pl.category ? `Content pillar: ${pl.category}` : "",
    pl.audience ? `Audience: ${pl.audience}` : "",
    pl.overlayText ? `Text on the image: ${pl.overlayText}` : "",
    pl.slides?.length ? `Slide texts:\n${pl.slides.map((x, i) => `${i + 1}. ${x}`).join("\n")}` : "",
    pl.cta ? `Call to action from the plan: ${pl.cta}` : "",
    pl.link ? `Link: ${pl.link}` : "",
    pl.firstComment ? `First comment (posted separately, do not repeat): ${pl.firstComment}` : "",
    pl.imagePrompt ? `The image (for context only, do not describe it): ${pl.imagePrompt.slice(0, 600)}` : "",
    pl.notes ? `Notes: ${pl.notes}` : "",
  ];
  return lines.filter(Boolean).join("\n").slice(0, 2000);
}

export type FillOutcome = "written" | "skipped";

/**
 * Writes the text of an existing planned post (or retries a failed one). Claims the row first (planned/failed →
 * generating) so two workers can never write the same post; a post that already has text is skipped.
 */
export async function generateForPost(db: Db, deps: GenerateDeps, ctx: OrgContext, postId: string): Promise<FillOutcome> {
  const p = await ownPost(db, ctx, postId);
  if (p.content || !p.channelId || (p.status !== "planned" && p.status !== "failed")) return "skipped";
  const r = await rulesFor(db, ctx, p.brandId, p.channelId);
  if (r.brand.archivedAt) throw new PostError("ARCHIVED");
  const model = await defaultModel(db, p.brandId);
  const claimed = await forOrg(db, ctx).update(
    posts,
    { status: "generating", error: null, updatedAt: new Date() },
    and(eq(posts.id, postId), inArray(posts.status, ["planned", "failed"]), sql`${posts.content} is null`)!,
  );
  if (!claimed.length) return "skipped";
  await writeInto(db, deps, ctx, postId, r, model, planBrief(p));
  return "written";
}

async function ownPost(db: Db, ctx: OrgContext, postId: string) {
  const [p] = (await forOrg(db, ctx).select(posts, eq(posts.id, postId))) as (typeof posts.$inferSelect)[];
  if (!p) throw new PostError("NOT_FOUND");
  return p;
}

/** A planned post (from a plan, no text yet) can get its text by hand too (TASK-012). */
const editable: PostStatus[] = ["planned", "ready", "needs_review", "approved"];

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
  skipped: ["ready", "planned"],
  failed: ["skipped"],
  planned: ["skipped"],
};

/** Status moves a person makes (approve, mark published, skip). Approving a post with failures is an explicit override. */
export async function setPostStatus(db: Db, ctx: OrgContext, postId: string, to: PostStatus) {
  const p = await ownPost(db, ctx, postId);
  if (!transitions[p.status]?.includes(to)) throw new PostError("BAD_STATE");
  // Back from "skipped": a post with text returns to ready, a text-less plan to planned.
  if (p.status === "skipped" && (to === "ready") !== !!p.content) throw new PostError("BAD_STATE");
  await forOrg(db, ctx).update(posts, { status: to, updatedAt: new Date(), ...(to === "published" ? { publishedAt: new Date() } : p.status === "published" ? { publishedAt: null } : {}) }, eq(posts.id, postId));
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
