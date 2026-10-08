// The plan (TASK-013): posts by calendar day across all brands of the org, the unscheduled pile, the published
// history, and moving a post to another slot. Every query is bounded by ctx.orgId.
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { isIsoDate } from "@/lib/dates";
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
