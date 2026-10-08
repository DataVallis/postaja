// Client approval links (TASK-041, ADR-069). Members create a link for one brand and a date range (≤ 31 days); only
// the token's sha256 is stored and the link is shown once. Anyone holding a valid link (not revoked, not expired) sees
// that brand's posts in the range — text, current images and videos — and approves a post or asks for changes with a
// comment. An approval moves a ready post to "approved"; a change request moves an approved post back to "ready". Every
// review is kept on the post. Nothing outside the link's brand and range is reachable through it.
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lte, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { addDays, isIsoDate } from "@/lib/dates";
import { getBrandDetail } from "../brands/service";
import type { Db } from "../db/client";
import { approvalLinks, auditLog, brands, channels, postMedia, postReviews, posts, postVideos } from "../db/schema";
import type { Storage } from "../files/storage";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";

export const LINK_MAX_DAYS = 31;
export const LINK_GRACE_DAYS = 14;
export const REVIEWS_PER_HOUR = 300;

export class ReviewError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "INVALID" | "ARCHIVED" | "GONE" | "BAD_STATE" | "TOO_MANY") {
    super(code);
  }
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

const linkInput = z.object({
  label: z.string().trim().min(1).max(120),
  from: z.string().refine(isIsoDate),
  to: z.string().refine(isIsoDate),
});

/** Any member: a new link for the brand's posts from `from` to `to`. Returns the token — shown once, never stored. */
export async function createApprovalLink(db: Db, ctx: OrgContext, brandId: string, input: z.input<typeof linkInput>, now = new Date()) {
  const r = linkInput.safeParse(input);
  if (!r.success) throw new ReviewError("INVALID");
  const { from, to, label } = r.data;
  if (to < from || addDays(from, LINK_MAX_DAYS - 1) < to) throw new ReviewError("INVALID");
  const { brand } = await getBrandDetail(db, ctx, brandId).catch(() => { throw new ReviewError("NOT_FOUND"); });
  if (brand.archivedAt) throw new ReviewError("ARCHIVED");
  const token = randomBytes(32).toString("base64url");
  const id = crypto.randomUUID();
  const expiresAt = new Date(`${addDays(to, LINK_GRACE_DAYS)}T23:59:59Z`);
  if (expiresAt <= now) throw new ReviewError("INVALID");
  await forOrg(db, ctx).insert(approvalLinks, { id, brandId, tokenHash: hash(token), label, fromDate: from, toDate: to, expiresAt, createdBy: ctx.userId });
  await db.insert(auditLog).values({ id: crypto.randomUUID(), actorUserId: ctx.userId, orgId: ctx.orgId, action: "approval_link.create", target: id, meta: { brandId, from, to } });
  return { id, token };
}

/** The brand's links, newest first (tokens are never shown again). Any member. */
export async function listApprovalLinks(db: Db, ctx: OrgContext, brandId: string) {
  return (await forOrg(db, ctx).select(approvalLinks, eq(approvalLinks.brandId, brandId)).orderBy(desc(approvalLinks.createdAt))) as (typeof approvalLinks.$inferSelect)[];
}

/** Any member: the link stops working at once. */
export async function revokeApprovalLink(db: Db, ctx: OrgContext, id: string) {
  const done = await forOrg(db, ctx).update(approvalLinks, { revokedAt: new Date() }, and(eq(approvalLinks.id, id), isNull(approvalLinks.revokedAt))!);
  if (!done.length) throw new ReviewError("NOT_FOUND");
  await db.insert(auditLog).values({ id: crypto.randomUUID(), actorUserId: ctx.userId, orgId: ctx.orgId, action: "approval_link.revoke", target: id, meta: {} });
}

// ---- The client's side (no account: the token is the key) ----------------------------------------------------------

type Link = typeof approvalLinks.$inferSelect;

/** The link for `token` when it still works, else GONE (unknown, revoked or expired look the same). */
export async function linkByToken(db: Db, token: string, now = new Date()): Promise<Link & { brandName: string }> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new ReviewError("GONE");
  const [row] = await db.select({ link: approvalLinks, brandName: brands.name }).from(approvalLinks)
    .innerJoin(brands, and(eq(brands.id, approvalLinks.brandId), eq(brands.orgId, approvalLinks.orgId)))
    .where(eq(approvalLinks.tokenHash, hash(token)));
  if (!row || row.link.revokedAt || row.link.expiresAt <= now) throw new ReviewError("GONE");
  return { ...row.link, brandName: row.brandName };
}

const inScope = (l: Link) => and(
  eq(posts.orgId, l.orgId), eq(posts.brandId, l.brandId),
  gte(posts.scheduledOn, l.fromDate), lte(posts.scheduledOn, l.toDate),
  notInArray(posts.status, ["skipped", "failed"]),
);

/** What the client sees: the link's posts in time order with their text, images, videos and the latest review. */
export async function clientView(db: Db, token: string, now = new Date()) {
  const link = await linkByToken(db, token, now);
  await db.update(approvalLinks).set({ lastViewedAt: now }).where(eq(approvalLinks.id, link.id));
  const list = await db.select({
    id: posts.id, status: posts.status, format: posts.format, scheduledOn: posts.scheduledOn, scheduledTime: posts.scheduledTime,
    content: posts.content, topic: sql<string | null>`${posts.plan}->>'topic'`, brief: posts.brief, platform: channels.platform, handle: channels.handle,
  }).from(posts).leftJoin(channels, and(eq(channels.id, posts.channelId), eq(channels.orgId, posts.orgId)))
    .where(inScope(link)).orderBy(asc(posts.scheduledOn), sql`${posts.scheduledTime} asc nulls last`, asc(posts.createdAt)).limit(200);
  const ids = list.map((p) => p.id);
  const [media, videos, reviews] = ids.length ? await Promise.all([
    db.select({ id: postMedia.id, postId: postMedia.postId, position: postMedia.position, width: postMedia.width, height: postMedia.height }).from(postMedia)
      .where(and(eq(postMedia.orgId, link.orgId), inArray(postMedia.postId, ids), eq(postMedia.kind, "slide"), isNull(postMedia.archivedAt))).orderBy(asc(postMedia.position)),
    db.select({ id: postVideos.id, postId: postVideos.postId }).from(postVideos).where(and(eq(postVideos.orgId, link.orgId), inArray(postVideos.postId, ids))).orderBy(asc(postVideos.createdAt)),
    db.select().from(postReviews).where(and(eq(postReviews.orgId, link.orgId), inArray(postReviews.postId, ids))).orderBy(desc(postReviews.createdAt)),
  ]) : [[], [], []];
  return {
    link: { brandName: link.brandName, from: link.fromDate, to: link.toDate, expiresAt: link.expiresAt },
    posts: list.map((p) => ({
      ...p,
      images: media.filter((m) => m.postId === p.id),
      videos: videos.filter((v) => v.postId === p.id),
      review: reviews.find((r) => r.postId === p.id) ?? null,
      canReview: ["ready", "needs_review", "approved"].includes(p.status),
    })),
  };
}

const reviewInput = z.object({
  decision: z.enum(["approved", "changes"]),
  comment: z.string().trim().max(2000).default(""),
  reviewer: z.string().trim().max(80).default(""),
});

/** The client approves a post or asks for changes (a comment is required then). */
export async function submitReview(db: Db, token: string, postId: string, input: z.input<typeof reviewInput>, now = new Date()) {
  const link = await linkByToken(db, token, now);
  const r = reviewInput.safeParse(input);
  if (!r.success || (r.data.decision === "changes" && !r.data.comment)) throw new ReviewError("INVALID");
  const [p] = await db.select({ id: posts.id, status: posts.status }).from(posts).where(and(inScope(link), eq(posts.id, postId)));
  if (!p) throw new ReviewError("NOT_FOUND");
  if (!["ready", "needs_review", "approved"].includes(p.status)) throw new ReviewError("BAD_STATE");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(postReviews)
    .where(and(eq(postReviews.linkId, link.id), gte(postReviews.createdAt, new Date(now.getTime() - 3_600_000))));
  if (n >= REVIEWS_PER_HOUR) throw new ReviewError("TOO_MANY");
  await db.transaction(async (tx) => {
    await tx.insert(postReviews).values({ id: crypto.randomUUID(), orgId: link.orgId, postId, linkId: link.id, ...r.data, createdAt: now });
    const to = r.data.decision === "approved" ? (p.status === "ready" ? "approved" : null) : p.status === "approved" ? "ready" : null;
    if (to) await tx.update(posts).set({ status: to, updatedAt: now }).where(and(eq(posts.id, postId), eq(posts.orgId, link.orgId)));
  });
}

/** A short-lived link to an image or video of a post the link covers. */
export async function clientMediaUrl(db: Db, storage: Storage, token: string, id: string, now = new Date()) {
  const link = await linkByToken(db, token, now);
  const [img] = await db.select({ key: postMedia.storageKey, type: postMedia.contentType }).from(postMedia)
    .innerJoin(posts, eq(posts.id, postMedia.postId))
    .where(and(inScope(link), eq(postMedia.id, id), eq(postMedia.kind, "slide"), isNull(postMedia.archivedAt)));
  if (img) return storage.presignGet(img.key, { filename: `slika.${img.type === "image/png" ? "png" : "jpg"}`, contentType: img.type, inline: true });
  const [vid] = await db.select({ key: postVideos.storageKey }).from(postVideos)
    .innerJoin(posts, eq(posts.id, postVideos.postId))
    .where(and(inScope(link), eq(postVideos.id, id)));
  if (vid) return storage.presignGet(vid.key, { filename: "video.mp4", contentType: "video/mp4", inline: true });
  throw new ReviewError("NOT_FOUND");
}

/** The client's reviews of a post, newest first (agency side). */
export async function postReviewsFor(db: Db, ctx: OrgContext, postId: string) {
  return (await forOrg(db, ctx).select(postReviews, eq(postReviews.postId, postId)).orderBy(desc(postReviews.createdAt))) as (typeof postReviews.$inferSelect)[];
}

/** The latest client review of each of `postIds` (for badges in lists). */
export async function latestReviews(db: Db, ctx: OrgContext, postIds: string[]) {
  if (!postIds.length) return new Map<string, typeof postReviews.$inferSelect>();
  const rows = await db.select().from(postReviews).where(and(eq(postReviews.orgId, ctx.orgId), inArray(postReviews.postId, postIds))).orderBy(desc(postReviews.createdAt));
  const out = new Map<string, typeof postReviews.$inferSelect>();
  for (const r of rows) if (!out.has(r.postId)) out.set(r.postId, r);
  return out;
}
