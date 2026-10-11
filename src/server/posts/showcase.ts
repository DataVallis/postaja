// What the owner sees first (TASK-056, ADR-082): the work Postaja did this month and what it is worth, the cover image
// of each post (when it has one), and each brand as a card with its colours. Read-only, bounded by ctx.orgId.
import { and, asc, eq, gte, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { brandAssets, brandDesigns, brands, channels, postMedia, posts, usageLedger } from "../db/schema";
import { monthStart } from "../llm/spend";
import type { OrgContext } from "../tenancy/context";

/**
 * Minutes a person would spend on one piece of work Postaja did (owner's estimate, 2026-10-11): writing a post in the
 * brand's voice, and making its graphic. Shown as an estimate, never as a measurement.
 */
export const MINUTES_SAVED = { text: 20, image: 15 } as const;
/** Hourly rate the saved time is valued at (shown next to the number as an assumption). */
export const HOURLY_EUR = 40;

export type MonthValue = { posts: number; images: number; brands: number; minutes: number; valueEur: number };

/** This month's work by Postaja: posts written (first attempts), illustrations drawn, and the time and value saved. */
export async function monthValue(db: Db, ctx: OrgContext, now = new Date()): Promise<MonthValue> {
  const rows = await db
    .select({ action: usageLedger.action, n: sql<number>`count(*)::int` })
    .from(usageLedger)
    .where(and(eq(usageLedger.orgId, ctx.orgId), eq(usageLedger.state, "settled"), gte(usageLedger.createdAt, monthStart(now)), inArray(usageLedger.action, ["text", "illustration"])))
    .groupBy(usageLedger.action);
  const [{ brandCount }] = await db
    .select({ brandCount: sql<number>`count(distinct ${usageLedger.brandId})::int` })
    .from(usageLedger)
    .where(and(eq(usageLedger.orgId, ctx.orgId), eq(usageLedger.state, "settled"), gte(usageLedger.createdAt, monthStart(now)), inArray(usageLedger.action, ["text", "illustration"])));
  const n = (a: string) => rows.find((r) => r.action === a)?.n ?? 0;
  const postsN = n("text");
  const images = n("illustration");
  const minutes = postsN * MINUTES_SAVED.text + images * MINUTES_SAVED.image;
  return { posts: postsN, images, brands: brandCount, minutes, valueEur: Math.round((minutes / 60) * HOURLY_EUR) };
}

/** The first image of each post (slide 1 of its current version), by post id. Posts without images are left out. */
export async function coverImages(db: Db, ctx: OrgContext, postIds: string[]): Promise<Map<string, string>> {
  if (!postIds.length) return new Map();
  const rows = await db
    .select({ postId: postMedia.postId, id: postMedia.id })
    .from(postMedia)
    .where(and(eq(postMedia.orgId, ctx.orgId), inArray(postMedia.postId, postIds.slice(0, 500)), eq(postMedia.kind, "slide"), eq(postMedia.position, 0), isNull(postMedia.archivedAt)));
  return new Map(rows.map((r) => [r.postId, r.id]));
}

export type BrandCard = {
  id: string; name: string; colors: string[]; logoId: string | null; platforms: string[];
  upcoming: number; next: string | null;
};

/** Live brands as cards: colours of the current design, logo, channels, upcoming posts and the next planned day. */
export async function brandCards(db: Db, ctx: OrgContext, today: string, limit = 12): Promise<BrandCard[]> {
  const list = await db
    .select({ id: brands.id, name: brands.name, designId: brands.currentDesignId })
    .from(brands).where(and(eq(brands.orgId, ctx.orgId), isNull(brands.archivedAt))).orderBy(asc(brands.name)).limit(limit);
  if (!list.length) return [];
  const ids = list.map((b) => b.id);
  const designIds = list.map((b) => b.designId).filter((x): x is string => !!x);
  const [designs, logos, chans, upcoming] = await Promise.all([
    designIds.length ? db.select({ id: brandDesigns.id, spec: brandDesigns.spec }).from(brandDesigns).where(and(eq(brandDesigns.orgId, ctx.orgId), inArray(brandDesigns.id, designIds))) : Promise.resolve([]),
    db.select({ brandId: brandAssets.brandId, id: brandAssets.id, at: brandAssets.createdAt }).from(brandAssets)
      .where(and(eq(brandAssets.orgId, ctx.orgId), inArray(brandAssets.brandId, ids), eq(brandAssets.kind, "logo"))).orderBy(asc(brandAssets.createdAt)),
    db.select({ brandId: channels.brandId, platform: channels.platform }).from(channels).where(and(eq(channels.orgId, ctx.orgId), inArray(channels.brandId, ids))),
    db.select({ brandId: posts.brandId, n: sql<number>`count(*)::int`, next: sql<string | null>`min(${posts.scheduledOn})::text` }).from(posts)
      .where(and(eq(posts.orgId, ctx.orgId), inArray(posts.brandId, ids), gte(posts.scheduledOn, today), notInArray(posts.status, ["published", "skipped"])))
      .groupBy(posts.brandId),
  ]);
  return list.map((b) => {
    const spec = designs.find((d) => d.id === b.designId)?.spec;
    const p = spec?.palette;
    const colors = p ? [p.background, p.accent, p.text].filter(Boolean) : [];
    const mine = upcoming.find((u) => u.brandId === b.id);
    return {
      id: b.id, name: b.name, colors, logoId: logos.find((l) => l.brandId === b.id)?.id ?? null,
      platforms: [...new Set(chans.filter((c) => c.brandId === b.id).map((c) => c.platform))].sort(),
      upcoming: mine?.n ?? 0, next: mine?.next ?? null,
    };
  });
}

/** Every channel of the org's live brands (for picking which feed to look at). */
export async function feedChannels(db: Db, ctx: OrgContext) {
  return db
    .select({ id: channels.id, brandId: brands.id, brandName: brands.name, platform: channels.platform, handle: channels.handle })
    .from(channels).innerJoin(brands, and(eq(brands.id, channels.brandId), eq(brands.orgId, ctx.orgId), isNull(brands.archivedAt)))
    .where(eq(channels.orgId, ctx.orgId)).orderBy(asc(brands.name), asc(channels.platform));
}
