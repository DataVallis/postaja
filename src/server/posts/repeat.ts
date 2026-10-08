// No-repeat for posts (TASK-029, spec §8, ADR-059): a written post is compared with the brand's other written posts of
// the organization's window (default 180 days) — the same lexical measure and thresholds as post ideas (ADR-048), on
// the post's topic. At the warn threshold the match is shown on the post; at the block threshold the post goes to
// review ("blocked with override": approving it is the override).
import { and, desc, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { orgSettings, posts, type RepeatMatch } from "../db/schema";
import { REPEAT_BLOCK, REPEAT_WARN, similarity } from "../ideas/similar";
import type { OrgContext } from "../tenancy/context";

export const topicOf = (p: { topicSummary: string | null; plan: unknown; brief: string }) =>
  (p.topicSummary || (p.plan as { topic?: string } | null)?.topic || p.brief).slice(0, 300);

/** The closest earlier written post of the brand to `topic`, when at or above the warn threshold; else null. */
export async function repeatFor(db: Db, ctx: OrgContext, post: { id: string; brandId: string; topic: string }, now = new Date()): Promise<RepeatMatch | null> {
  const [s] = await db.select({ t: orgSettings.repeatThresholds }).from(orgSettings).where(eq(orgSettings.orgId, ctx.orgId));
  const days = s?.t?.windowDays ?? 180;
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await db
    .select({ id: posts.id, topicSummary: posts.topicSummary, plan: posts.plan, brief: posts.brief, scheduledOn: posts.scheduledOn, createdAt: posts.createdAt })
    .from(posts)
    .where(and(
      eq(posts.orgId, ctx.orgId), eq(posts.brandId, post.brandId), ne(posts.id, post.id),
      inArray(posts.status, ["ready", "needs_review", "approved", "published"]),
      or(gte(posts.createdAt, since), gte(posts.scheduledOn, since.toISOString().slice(0, 10)))!,
    )!)
    .orderBy(desc(sql`coalesce(${posts.scheduledOn}, ${posts.createdAt}::date)`))
    .limit(500);
  if (!rows.length || !post.topic.trim()) return null;
  const near = similarity(rows.map((r) => ({ id: r.id, text: topicOf(r) })), [post.topic]).closest(post.topic);
  if (!near || near.score < REPEAT_WARN) return null;
  const r = rows.find((x) => x.id === near.id)!;
  return { postId: r.id, label: topicOf(r).slice(0, 120), date: r.scheduledOn ?? r.createdAt.toISOString().slice(0, 10), score: Math.round(near.score * 100) / 100, blocks: near.score >= REPEAT_BLOCK };
}
