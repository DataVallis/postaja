// AI post ideas (TASK-019, spec §6.2–6.3, ADR-048). Claude proposes N ideas for a brand's channel; each is checked
// against the brand's posts of the last 180 days and the other ideas (no-repeat); repeats are replaced (at most two more
// rounds). Ideas get the channel's next free slots (its goal: posts per day, weekdays). The owner or an editor ticks
// what to keep → planned posts, written later by Postaja like any plan.
import { and, desc, eq, gte, isNotNull, ne, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { addDays, isIsoDate, isoWeekday, todayIn } from "@/lib/dates";
import { postLanguage } from "@/lib/language";
import { getBrandDetail } from "../brands/service";
import type { Db } from "../db/client";
import { ideaRuns, posts, type Idea } from "../db/schema";
import { cappedCall } from "../llm/call";
import { SpendCapError } from "../llm/spend";
import { LlmError, type LlmClient } from "../llm/types";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { IDEA_FORMATS, ideasRequest, ideasSchema, type IdeaFormat } from "./ai";
import { REPEAT_BLOCK, REPEAT_WARN, similarity } from "./similar";

export const IDEAS_MAX = 30;
const RECENT_DAYS = 180;
const RECENT_IN_PROMPT = 60;
const ROUNDS = 3;
const SLOT_HORIZON_DAYS = 180;

export class IdeaError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "INVALID" | "BAD_STATE" | "SPEND_CAP" | "AI_FAILED" | "NO_MODEL" | "NO_CHANNEL", public readonly detail?: string) {
    super(code);
  }
}

const suggestInput = z.object({
  brandId: z.string().min(1),
  channelId: z.string().min(1),
  count: z.number().int().min(1).max(IDEAS_MAX),
  from: z.string().refine((s) => isIsoDate(s)).optional(),
  hint: z.string().max(1000).default(""),
});

/** Channel types → post formats an idea may have. */
function formatsFor(platform: string, allowed: string[]): IdeaFormat[] {
  const f = new Set<IdeaFormat>();
  if (allowed.includes("text")) f.add(platform === "x" ? "thread" : "text");
  if (allowed.includes("text") && platform === "x") f.add("text");
  if (allowed.includes("single_image")) f.add("image");
  if (allowed.includes("carousel")) f.add("carousel");
  return f.size ? IDEA_FORMATS.filter((x) => f.has(x)) : ["text"];
}

/**
 * The channel's next free slots from `from`: on its weekdays, up to postsPerDay per day minus posts already there
 * (not skipped). No goal → one a day, every day. At most `n`, within SLOT_HORIZON_DAYS.
 */
export function freeSlots(goal: { postsPerDay: number; weekdays: number[] }, from: string, n: number, taken: Map<string, number>): string[] {
  const perDay = goal.postsPerDay > 0 ? goal.postsPerDay : 1;
  const days = goal.weekdays.length ? new Set(goal.weekdays) : new Set([1, 2, 3, 4, 5, 6, 7]);
  const out: string[] = [];
  for (let i = 0; i < SLOT_HORIZON_DAYS && out.length < n; i++) {
    const d = addDays(from, i);
    if (!days.has(isoWeekday(d))) continue;
    for (let k = taken.get(d) ?? 0; k < perDay && out.length < n; k++) out.push(d);
  }
  return out;
}

const topicOf = (p: { topicSummary: string | null; plan: unknown; brief: string }) =>
  (p.topicSummary || (p.plan as { topic?: string } | null)?.topic || p.brief).slice(0, 300);

/** Proposes ideas and stores them as a draft run. Any member (the spend cap guards cost). */
export async function suggestIdeas(db: Db, deps: { llm: LlmClient; now?: Date }, ctx: OrgContext, input: z.input<typeof suggestInput>): Promise<string> {
  const i = suggestInput.parse(input);
  const { brand, profile, channels } = await getBrandDetail(db, ctx, i.brandId).catch(() => { throw new IdeaError("NOT_FOUND"); });
  if (brand.archivedAt) throw new IdeaError("BAD_STATE");
  const channel = channels.find((c) => c.id === i.channelId);
  if (!channel) throw new IdeaError("NO_CHANNEL");
  const now = deps.now ?? new Date();
  const from = i.from ?? todayIn(undefined, now);

  // The brand's posts of the last 180 days (by slot or creation), planned included — skipped and failed ignored (§8).
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000);
  const recent = (await forOrg(db, ctx).select(posts, and(
    eq(posts.brandId, brand.id),
    notInArray(posts.status, ["skipped", "failed"]),
    or(gte(posts.createdAt, since), and(isNotNull(posts.scheduledOn), gte(posts.scheduledOn, since.toISOString().slice(0, 10))))!,
  )!).orderBy(desc(sql`coalesce(${posts.scheduledOn}, ${posts.createdAt}::date)`))) as (typeof posts.$inferSelect)[];
  const corpus = recent.map((p) => ({ id: p.id, text: topicOf(p) }));
  const sim = similarity(corpus);
  const byId = new Map(recent.map((p) => [p.id, p]));
  const pillars = (profile?.pillars ?? []).map((p) => ({
    ...p, recent: recent.filter((r) => (r.plan as { category?: string } | null)?.category?.toLowerCase() === p.name.toLowerCase()).length,
  }));
  const formats = formatsFor(channel.platform, channel.allowedTypes);

  const kept: (Omit<Idea, "date" | "similar"> & { similar: Idea["similar"] })[] = [];
  const avoid: string[] = [];
  let replaced = 0;
  for (let round = 0; round < ROUNDS && kept.length < i.count; round++) {
    const need = i.count - kept.length;
    let out;
    try {
      out = await cappedCall(db, deps.llm, { orgId: ctx.orgId, brandId: brand.id, postId: null, now }, ideasRequest({
        brandName: brand.name, language: postLanguage(channel.language, brand.languages), platform: channel.platform, formats,
        cgp: profile?.cgp ?? "", pillars, recent: recent.slice(0, RECENT_IN_PROMPT).map((p) => ({ date: p.scheduledOn, topic: topicOf(p) })),
        count: need, hint: i.hint, avoid: [...avoid, ...kept.map((k) => k.title)],
      }));
    } catch (e) {
      if (e instanceof SpendCapError) throw new IdeaError("SPEND_CAP");
      if (e instanceof LlmError) {
        if (kept.length) break; // keep what is already good
        throw new IdeaError(e.code === "NOT_CONFIGURED" ? "NO_MODEL" : "AI_FAILED", e.message);
      }
      throw e;
    }
    const parsed = ideasSchema(pillars.map((p) => p.name), formats, need).safeParse(out.input);
    if (!parsed.success) {
      if (kept.length) break;
      throw new IdeaError("AI_FAILED", "INVALID_OUTPUT");
    }
    for (const idea of parsed.data.ideas.slice(0, need)) {
      const text = `${idea.title}. ${idea.angle}`;
      const near = sim.closest(text);
      const twin = kept.some((k) => sim.between(text, `${k.title}. ${k.angle}`) >= REPEAT_BLOCK);
      if ((near && near.score >= REPEAT_BLOCK) || twin) {
        avoid.push(idea.title);
        replaced++;
        continue;
      }
      const p = near && near.score >= REPEAT_WARN ? byId.get(near.id) : undefined;
      kept.push({
        title: idea.title, angle: idea.angle, pillar: idea.pillar ?? null, format: idea.format,
        similar: p ? { postId: p.id, label: topicOf(p).slice(0, 120), date: p.scheduledOn, score: Math.round(near!.score * 100) / 100 } : null,
      });
    }
  }
  if (!kept.length) throw new IdeaError("AI_FAILED", "ALL_REPEATS");

  const taken = new Map<string, number>();
  const busy = await db.select({ d: posts.scheduledOn, n: sql<number>`count(*)::int` }).from(posts)
    .where(and(eq(posts.orgId, ctx.orgId), eq(posts.channelId, channel.id), gte(posts.scheduledOn, from), ne(posts.status, "skipped")))
    .groupBy(posts.scheduledOn);
  for (const b of busy) if (b.d) taken.set(b.d, b.n);
  const slots = freeSlots(channel.goal, from, kept.length, taken);
  const ideas: Idea[] = kept.map((k, n) => ({ ...k, date: slots[n] ?? null }));

  const id = crypto.randomUUID();
  await forOrg(db, ctx).insert(ideaRuns, { id, brandId: brand.id, channelId: channel.id, ideas, replaced, hint: i.hint, createdBy: ctx.userId });
  return id;
}

export async function getIdeaRun(db: Db, ctx: OrgContext, id: string) {
  const [r] = (await forOrg(db, ctx).select(ideaRuns, eq(ideaRuns.id, id))) as (typeof ideaRuns.$inferSelect)[];
  if (!r) throw new IdeaError("NOT_FOUND");
  return r;
}

const acceptInput = z.array(z.object({ index: z.number().int().min(0).max(IDEAS_MAX - 1), date: z.string().refine((s) => isIsoDate(s)).nullable() })).min(1).max(IDEAS_MAX);

/** The ticked ideas become planned posts on the run's channel (once: the run is locked and must be a draft). */
export async function acceptIdeas(db: Db, ctx: OrgContext, id: string, picks: z.input<typeof acceptInput>) {
  const chosen = acceptInput.parse(picks);
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(ideaRuns).where(and(eq(ideaRuns.id, id), eq(ideaRuns.orgId, ctx.orgId))).for("update");
    if (!r) throw new IdeaError("NOT_FOUND");
    if (r.status !== "draft") throw new IdeaError("BAD_STATE");
    const { brand, channels } = await getBrandDetail(tx as unknown as Db, ctx, r.brandId);
    if (!channels.some((c) => c.id === r.channelId) || !brand.currentProfileVersionId) throw new IdeaError("NO_CHANNEL");
    const t = forOrg(tx as unknown as Db, ctx);
    let created = 0;
    for (const c of chosen) {
      const idea = r.ideas[c.index];
      if (!idea) throw new IdeaError("INVALID");
      await t.insert(posts, {
        id: crypto.randomUUID(), brandId: brand.id, channelId: r.channelId, profileVersionId: brand.currentProfileVersionId,
        brief: `${idea.title}\n\n${idea.angle}`, status: "planned", format: idea.format, scheduledOn: c.date,
        plan: { topic: idea.title, notes: idea.angle, ...(idea.pillar ? { category: idea.pillar } : {}) }, createdBy: ctx.userId,
      });
      created++;
    }
    await t.update(ideaRuns, { status: "accepted", createdCount: created }, eq(ideaRuns.id, id));
    return { created };
  });
}

export async function discardIdeas(db: Db, ctx: OrgContext, id: string) {
  const rows = await forOrg(db, ctx).update(ideaRuns, { status: "discarded" }, and(eq(ideaRuns.id, id), eq(ideaRuns.status, "draft")));
  if (!rows.length) throw new IdeaError("BAD_STATE");
}

export async function listIdeaRuns(db: Db, ctx: OrgContext, brandId: string, limit = 10) {
  return (await forOrg(db, ctx).select(ideaRuns, eq(ideaRuns.brandId, brandId)).orderBy(desc(ideaRuns.createdAt)).limit(limit)) as (typeof ideaRuns.$inferSelect)[];
}
