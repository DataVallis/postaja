// The plan (TASK-013): posts by calendar day across all brands of the org, the unscheduled pile, the published
// history, and moving a post to another slot. Every query is bounded by ctx.orgId.
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { addDays, isIsoDate, isoWeekday } from "@/lib/dates";
import type { Db } from "../db/client";
import { brands, channels, posts, type PostStatus } from "../db/schema";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { PostError } from "./generate";

export type PlanFilters = { brandId?: string; platform?: string; status?: string; statuses?: PostStatus[] };

/** What the calendar shows unless the owner picks otherwise: work still to do (owner: published posts out of the way). */
export const CALENDAR_DEFAULT_STATUSES: PostStatus[] = ["planned", "generating", "ready", "needs_review", "failed", "approved"];

function filters(ctx: OrgContext, f: PlanFilters): SQL[] {
  const w: SQL[] = [eq(posts.orgId, ctx.orgId)];
  if (f.brandId) w.push(eq(posts.brandId, f.brandId));
  if (f.platform) w.push(eq(channels.platform, f.platform as typeof channels.$inferSelect.platform));
  if (f.status) w.push(eq(posts.status, f.status as PostStatus));
  return w;
}

const columns = {
  id: posts.id, status: posts.status, format: posts.format, scheduledOn: posts.scheduledOn, scheduledTime: posts.scheduledTime,
  publishedAt: posts.publishedAt, publishedUrl: posts.publishedUrl, brief: posts.brief, caption: sql<string | null>`${posts.content}->>'caption'`,
  topic: sql<string | null>`${posts.plan}->>'topic'`, brandId: posts.brandId, brandName: brands.name,
  platform: channels.platform, handle: channels.handle, channelId: posts.channelId, createdAt: posts.createdAt,
};

const base = (db: Db, ctx: OrgContext) =>
  db.select(columns).from(posts)
    .innerJoin(brands, and(eq(brands.id, posts.brandId), eq(brands.orgId, ctx.orgId)))
    .leftJoin(channels, and(eq(channels.id, posts.channelId), eq(channels.orgId, ctx.orgId)));

export type PlanPost = Awaited<ReturnType<typeof calendarPosts>>[number];

/** Posts with a slot between `from` and `to` (inclusive), in day/time order: of `statuses` when given, else all but skipped. */
export async function calendarPosts(db: Db, ctx: OrgContext, from: string, to: string, f: PlanFilters = {}) {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new PostError("BAD_STATE");
  const w = [...filters(ctx, f), gte(posts.scheduledOn, from), lte(posts.scheduledOn, to)];
  if (f.statuses) w.push(f.statuses.length ? inArray(posts.status, f.statuses) : sql`false`);
  else if (!f.status) w.push(sql`${posts.status} <> 'skipped'`);
  return base(db, ctx).where(and(...w)).orderBy(asc(posts.scheduledOn), sql`${posts.scheduledTime} asc nulls last`, asc(posts.createdAt)).limit(2000);
}

/** Posts still waiting for a slot (not published, not skipped). */
export async function unscheduledPosts(db: Db, ctx: OrgContext, f: PlanFilters = {}, limit = 200) {
  const w = [...filters(ctx, f), isNull(posts.scheduledOn), sql`${posts.status} not in ('published','skipped')`];
  const [rows, [{ n }]] = await Promise.all([
    base(db, ctx).where(and(...w)).orderBy(desc(posts.createdAt)).limit(limit),
    db.select({ n: count() }).from(posts).leftJoin(channels, and(eq(channels.id, posts.channelId), eq(channels.orgId, ctx.orgId))).where(and(...w)),
  ]);
  return { rows, total: Number(n) };
}

export const HISTORY_PAGE = 50;

/** Published posts, newest publication first (imported history included). */
export async function historyPosts(db: Db, ctx: OrgContext, f: PlanFilters & { page?: number } = {}) {
  const w = [...filters(ctx, { ...f, status: undefined }), eq(posts.status, "published")];
  const page = f.page ?? 1;
  const [rows, [{ n }]] = await Promise.all([
    base(db, ctx).where(and(...w)).orderBy(sql`coalesce(${posts.publishedAt}, ${posts.updatedAt}) desc`).limit(HISTORY_PAGE).offset((page - 1) * HISTORY_PAGE),
    db.select({ n: count() }).from(posts).leftJoin(channels, and(eq(channels.id, posts.channelId), eq(channels.orgId, ctx.orgId))).where(and(...w)),
  ]);
  return { rows, total: Number(n), page, pages: Math.max(1, Math.ceil(Number(n) / HISTORY_PAGE)) };
}

const slotInput = z.object({
  date: z.string().refine((s) => isIsoDate(s)).nullable(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
}).refine((s) => s.date !== null || s.time === null, { message: "time needs a date" });

/** Any member moves a post to another day/time, or takes it off the plan (date null). Published posts keep their slot. */
export async function reschedulePost(db: Db, ctx: OrgContext, postId: string, input: z.input<typeof slotInput>) {
  const s = slotInput.parse(input);
  const [p] = (await forOrg(db, ctx).select(posts, eq(posts.id, postId))) as (typeof posts.$inferSelect)[];
  if (!p) throw new PostError("NOT_FOUND");
  if (p.status === "published") throw new PostError("BAD_STATE");
  await forOrg(db, ctx).update(posts, { scheduledOn: s.date, scheduledTime: s.time, updatedAt: new Date() }, eq(posts.id, postId));
}

/** How far ahead the calendar is filled at most (a year of days). */
export const FILL_MAX_DAYS = 366;

const fillInput = z.object({
  from: z.string().refine((s) => isIsoDate(s)),
  brandId: z.string().min(1).max(100).optional(),
  postIds: z.array(z.string().min(1).max(100)).max(5000).optional(),
});

/**
 * "Razporedi v koledar" (owner, 2026-10-13: imported plans without dates stayed off the calendar). Unscheduled posts —
 * all of the org, one brand's, or the given ones — get days from `from` on, in the order they were made (a plan's order),
 * each on its channel's posting days (goal weekdays) with at most the channel's posts per day, counting what is already
 * on those days. Posts without a channel get one a day per brand. Returns how many got a day.
 */
export async function fillSchedule(db: Db, ctx: OrgContext, input: z.input<typeof fillInput>): Promise<number> {
  const f = fillInput.parse(input);
  const w: SQL[] = [eq(posts.orgId, ctx.orgId), isNull(posts.scheduledOn), sql`${posts.status} not in ('published','skipped')`];
  if (f.brandId) w.push(eq(posts.brandId, f.brandId));
  if (f.postIds) w.push(f.postIds.length ? inArray(posts.id, f.postIds) : sql`false`);
  const pending = await db.select({ id: posts.id, channelId: posts.channelId, brandId: posts.brandId, goal: channels.goal })
    .from(posts).leftJoin(channels, and(eq(channels.id, posts.channelId), eq(channels.orgId, ctx.orgId)))
    .where(and(...w)).orderBy(asc(posts.createdAt), sql`${posts.plan}->>'sourceRef' asc nulls last`, asc(posts.id));
  if (!pending.length) return 0;
  const to = addDays(f.from, FILL_MAX_DAYS);
  // What is already on the calendar per channel (or brand, for posts without a channel) and day.
  const taken = new Map<string, number>();
  const busy = await db.select({ channelId: posts.channelId, brandId: posts.brandId, day: posts.scheduledOn, n: count() }).from(posts)
    .where(and(eq(posts.orgId, ctx.orgId), gte(posts.scheduledOn, f.from), lte(posts.scheduledOn, to), sql`${posts.status} <> 'skipped'`))
    .groupBy(posts.channelId, posts.brandId, posts.scheduledOn);
  const lane = (channelId: string | null, brandId: string) => (channelId ? `c:${channelId}` : `b:${brandId}`);
  for (const b of busy) taken.set(`${lane(b.channelId, b.brandId)}|${b.day}`, Number(b.n));
  // Where each lane continues (its next day to look at), so one walk per lane.
  const cursor = new Map<string, string>();
  const updates: { id: string; day: string }[] = [];
  for (const p of pending) {
    const key = lane(p.channelId, p.brandId);
    const days = p.goal?.weekdays?.length ? new Set(p.goal.weekdays) : new Set([1, 2, 3, 4, 5, 6, 7]);
    const perDay = Math.max(1, p.goal?.postsPerDay ?? 1);
    let day = cursor.get(key) ?? f.from;
    while (day <= to && (!days.has(isoWeekday(day)) || (taken.get(`${key}|${day}`) ?? 0) >= perDay)) day = addDays(day, 1);
    if (day > to) continue;
    taken.set(`${key}|${day}`, (taken.get(`${key}|${day}`) ?? 0) + 1);
    cursor.set(key, day);
    updates.push({ id: p.id, day });
  }
  await db.transaction(async (tx) => {
    for (const u of updates) {
      await forOrg(tx as unknown as Db, ctx).update(posts, { scheduledOn: u.day, updatedAt: new Date() }, and(eq(posts.id, u.id), isNull(posts.scheduledOn))!);
    }
  });
  return updates.length;
}
