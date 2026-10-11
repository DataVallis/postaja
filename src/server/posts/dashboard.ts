// Dashboard numbers (TASK-020, spec §10): today per brand × channel against its goal, each brand's streak of days
// that met every channel's goal, and this month's AI spend per brand. Read-only, bounded by ctx.orgId.
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { addDays, isoWeekday } from "@/lib/dates";
import type { Db } from "../db/client";
import { brands, channels, posts, usageLedger } from "../db/schema";
import { monthStart } from "../llm/spend";
import type { OrgContext } from "../tenancy/context";

/** Posts a channel's goal asks for on `day` (0 on days that are not its weekdays). */
export const goalOn = (goal: { postsPerDay: number; weekdays: number[] }, day: string) =>
  goal.weekdays.includes(isoWeekday(day)) ? goal.postsPerDay : 0;

const DONE = new Set(["ready", "approved", "published"]);

export type ChannelToday = {
  brandId: string; brandName: string; channelId: string; platform: string; handle: string;
  goal: number; planned: number; done: number; published: number; missing: number;
};

/** Today per channel of live brands: goal, posts on the day (not skipped), ready-or-better, published, and slots without a post. */
export async function todayByChannel(db: Db, ctx: OrgContext, day: string): Promise<ChannelToday[]> {
  const [chans, counts] = await Promise.all([
    db.select({ id: channels.id, platform: channels.platform, handle: channels.handle, goal: channels.goal, brandId: brands.id, brandName: brands.name })
      .from(channels).innerJoin(brands, and(eq(brands.id, channels.brandId), eq(brands.orgId, ctx.orgId), isNull(brands.archivedAt)))
      .where(eq(channels.orgId, ctx.orgId)).orderBy(brands.name, channels.platform),
    db.select({ channelId: posts.channelId, status: posts.status, n: sql<number>`count(*)::int` }).from(posts)
      .where(and(eq(posts.orgId, ctx.orgId), eq(posts.scheduledOn, day), sql`${posts.status} <> 'skipped'`))
      .groupBy(posts.channelId, posts.status),
  ]);
  return chans.map((c) => {
    const mine = counts.filter((x) => x.channelId === c.id);
    const planned = mine.reduce((n, x) => n + x.n, 0);
    const goal = goalOn(c.goal, day);
    return {
      brandId: c.brandId, brandName: c.brandName, channelId: c.id, platform: c.platform, handle: c.handle, goal, planned,
      done: mine.filter((x) => DONE.has(x.status)).reduce((n, x) => n + x.n, 0),
      published: mine.filter((x) => x.status === "published").reduce((n, x) => n + x.n, 0),
      missing: Math.max(0, goal - planned),
    };
  }).filter((r) => r.goal > 0 || r.planned > 0);
}

const STREAK_DAYS = 120;

/**
 * Per brand: consecutive days, back from yesterday (today counts too once it is met), on which every channel with a
 * goal that day had at least its goal in published posts. Days with no goal on any channel are skipped, not breaks.
 */
export async function brandStreaks(db: Db, ctx: OrgContext, today: string): Promise<Map<string, number>> {
  const from = addDays(today, -STREAK_DAYS);
  const [chans, pub] = await Promise.all([
    db.select({ id: channels.id, brandId: channels.brandId, goal: channels.goal }).from(channels)
      .innerJoin(brands, and(eq(brands.id, channels.brandId), eq(brands.orgId, ctx.orgId), isNull(brands.archivedAt)))
      .where(eq(channels.orgId, ctx.orgId)),
    db.select({ channelId: posts.channelId, day: posts.scheduledOn, n: sql<number>`count(*)::int` }).from(posts)
      .where(and(eq(posts.orgId, ctx.orgId), eq(posts.status, "published"), gte(posts.scheduledOn, from), lte(posts.scheduledOn, today)))
      .groupBy(posts.channelId, posts.scheduledOn),
  ]);
  const published = new Map(pub.map((p) => [`${p.channelId}|${p.day}`, p.n]));
  const byBrand = new Map<string, typeof chans>();
  for (const c of chans) byBrand.set(c.brandId, [...(byBrand.get(c.brandId) ?? []), c]);
  const out = new Map<string, number>();
  for (const [brandId, list] of byBrand) {
    const met = (d: string) => list.every((c) => (published.get(`${c.id}|${d}`) ?? 0) >= goalOn(c.goal, d));
    const counts = (d: string) => list.some((c) => goalOn(c.goal, d) > 0);
    let streak = counts(today) && met(today) ? 1 : 0;
    for (let i = 1; i <= STREAK_DAYS; i++) {
      const d = addDays(today, -i);
      if (!counts(d)) continue;
      if (!met(d)) break;
      streak++;
    }
    out.set(brandId, streak);
  }
  return out;
}

/** This month's AI spend per brand (micro-USD); spend without a brand (plan imports) under null. */
export async function costsByBrand(db: Db, ctx: OrgContext, now = new Date()) {
  const rows = await db.select({ brandId: usageLedger.brandId, total: sql<string>`sum(${usageLedger.costMicroUsd})::text` }).from(usageLedger)
    .where(and(eq(usageLedger.orgId, ctx.orgId), gte(usageLedger.createdAt, monthStart(now))))
    .groupBy(usageLedger.brandId);
  return new Map(rows.map((r) => [r.brandId, BigInt(r.total)]));
}
