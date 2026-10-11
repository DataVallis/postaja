// Organization-wide views of posts (TASK-011): dashboard numbers and the filtered posts table.
// Every query is bounded by ctx.orgId; brand and channel names come from joins on the same org.
import { and, asc, count, desc, eq, gte, ilike, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { brands, channels, orgSettings, posts, type PostStatus } from "../db/schema";
import { monthStart, monthToDate } from "../llm/spend";
import type { OrgContext } from "../tenancy/context";

export const POST_STATUSES: PostStatus[] = ["planned", "generating", "ready", "needs_review", "approved", "published", "skipped", "failed"];
export const PAGE_SIZE = 50;

export type PostFilters = { q?: string; brandId?: string; status?: string; platform?: string; importId?: string; page?: number };

export function parsePostFilters(sp: Record<string, string | string[] | undefined>): PostFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "") || undefined;
  const status = one("status");
  const page = Number(one("page") ?? 1);
  return {
    q: one("q")?.slice(0, 200),
    brandId: one("brand"),
    status: status && (POST_STATUSES as string[]).includes(status) ? status : undefined,
    platform: one("platform"),
    importId: one("import"),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** Posts of the caller's org, newest first, with brand and channel names. */
export async function listOrgPosts(db: Db, ctx: OrgContext, f: PostFilters = {}) {
  const where: SQL[] = [eq(posts.orgId, ctx.orgId)];
  if (f.brandId) where.push(eq(posts.brandId, f.brandId));
  if (f.status) where.push(eq(posts.status, f.status as PostStatus));
  if (f.importId) where.push(eq(posts.importId, f.importId));
  if (f.platform) where.push(eq(channels.platform, f.platform as typeof channels.$inferSelect.platform));
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(or(ilike(posts.brief, like), sql`${posts.content}->>'caption' ilike ${like}`)!);
  }
  const page = f.page ?? 1;
  const base = db
    .select({
      id: posts.id, status: posts.status, publishedUrl: posts.publishedUrl, brief: posts.brief, caption: sql<string | null>`${posts.content}->>'caption'`,
      createdAt: posts.createdAt, updatedAt: posts.updatedAt, brandId: posts.brandId, brandName: brands.name,
      format: posts.format, scheduledOn: posts.scheduledOn, scheduledTime: posts.scheduledTime, topic: sql<string | null>`${posts.plan}->>'topic'`,
      platform: channels.platform, handle: channels.handle,
    })
    .from(posts)
    .innerJoin(brands, and(eq(brands.id, posts.brandId), eq(brands.orgId, posts.orgId)))
    .leftJoin(channels, and(eq(channels.id, posts.channelId), eq(channels.orgId, posts.orgId)))
    .where(and(...where));
  const [rows, [{ n }]] = await Promise.all([
    // An import is a plan: show it in plan order (day, time); everything else newest first.
    (f.importId ? base.orderBy(sql`${posts.scheduledOn} asc nulls last`, asc(posts.scheduledTime), asc(posts.createdAt)) : base.orderBy(desc(posts.createdAt))).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(posts).leftJoin(channels, and(eq(channels.id, posts.channelId), eq(channels.orgId, posts.orgId))).where(and(...where)),
  ]);
  return { rows, total: Number(n), page, pages: Math.max(1, Math.ceil(Number(n) / PAGE_SIZE)) };
}

/** Numbers for the dashboard: posts by status, published this month, brands, provider spend vs cap. */
export async function orgOverview(db: Db, ctx: OrgContext, now = new Date()) {
  const [byStatus, [{ published }], [{ brandCount }], spent, [settings]] = await Promise.all([
    db.select({ status: posts.status, n: count() }).from(posts).where(eq(posts.orgId, ctx.orgId)).groupBy(posts.status),
    db.select({ published: count() }).from(posts).where(and(eq(posts.orgId, ctx.orgId), eq(posts.status, "published"), gte(posts.updatedAt, monthStart(now)))),
    db.select({ brandCount: count() }).from(brands).where(and(eq(brands.orgId, ctx.orgId), sql`${brands.archivedAt} is null`)),
    monthToDate(db, ctx.orgId, now),
    db.select({ cap: orgSettings.spendCapMicroUsd }).from(orgSettings).where(eq(orgSettings.orgId, ctx.orgId)),
  ]);
  const counts = Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])) as Partial<Record<PostStatus, number>>;
  return {
    planned: counts.planned ?? 0,
    ready: counts.ready ?? 0,
    needsReview: counts.needs_review ?? 0,
    approved: counts.approved ?? 0,
    failed: counts.failed ?? 0,
    publishedThisMonth: Number(published),
    brands: Number(brandCount),
    spentMicroUsd: spent,
    capMicroUsd: settings?.cap ?? 0n,
  };
}

/** Per brand of the org: channel count, post count, posts waiting (ready + needs review), last post. */
export async function brandStats(db: Db, ctx: OrgContext) {
  const [chans, ps] = await Promise.all([
    db.select({ brandId: channels.brandId, n: count() }).from(channels).where(eq(channels.orgId, ctx.orgId)).groupBy(channels.brandId),
    db
      .select({
        brandId: posts.brandId, n: count(),
        waiting: sql<number>`count(*) filter (where ${posts.status} in ('ready','needs_review'))`,
        last: sql<Date | null>`max(${posts.createdAt})`,
      })
      .from(posts).where(eq(posts.orgId, ctx.orgId)).groupBy(posts.brandId),
  ]);
  const out = new Map<string, { channels: number; posts: number; waiting: number; last: Date | null }>();
  for (const c of chans) out.set(c.brandId, { channels: Number(c.n), posts: 0, waiting: 0, last: null });
  for (const p of ps) {
    const cur = out.get(p.brandId) ?? { channels: 0, posts: 0, waiting: 0, last: null };
    out.set(p.brandId, { ...cur, posts: Number(p.n), waiting: Number(p.waiting), last: p.last ? new Date(p.last) : null });
  }
  return out;
}
