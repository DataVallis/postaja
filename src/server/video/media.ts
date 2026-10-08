// A post's videos (TASK-032, ADR-061): every animation and persona video stays until a member deletes it — a new one
// is added next to the earlier ones (owner: "kar je enkrat kreirano naj bo vedno dostopno, razen če se zbriše").
// Rows are the only way to the files (org-scoped); URLs are short presigned redirects.
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { brands, posts, postVideos, type PostVideoKind } from "../db/schema";
import type { Storage } from "../files/storage";
import { ImageJobError } from "../images/service";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";

export type PostVideoRow = typeof postVideos.$inferSelect;

/** The post's videos of one kind (or all), newest first. Any member. */
export async function listPostVideos(db: Db, ctx: OrgContext, postId: string, kind?: PostVideoKind): Promise<PostVideoRow[]> {
  return db.select().from(postVideos)
    .where(and(eq(postVideos.orgId, ctx.orgId), eq(postVideos.postId, postId), ...(kind ? [eq(postVideos.kind, kind)] : []))!)
    .orderBy(desc(postVideos.createdAt));
}

/** Post ids (of these) that have at least one video of `kind`. */
export async function postsWithVideo(db: Db, ctx: OrgContext, postIds: string[], kind: PostVideoKind): Promise<Set<string>> {
  if (!postIds.length) return new Set();
  const rows = await db.selectDistinct({ id: postVideos.postId }).from(postVideos)
    .where(and(eq(postVideos.orgId, ctx.orgId), eq(postVideos.kind, kind), inArray(postVideos.postId, postIds)));
  return new Set(rows.map((r) => r.id));
}

/** Stores a finished video row (the files are already in storage). */
export async function addPostVideo(db: Db, ctx: OrgContext, v: Omit<typeof postVideos.$inferInsert, "id" | "orgId" | "createdBy">) {
  const id = crypto.randomUUID();
  await forOrg(db, ctx).insert(postVideos, { ...v, id, createdBy: ctx.userId });
  return id;
}

/** A presigned URL for a video (or its poster) of the org; named after brand, day and number. */
export async function postVideoUrl(db: Db, storage: Storage, ctx: OrgContext, id: string, o: { download: boolean; poster: boolean }) {
  const [v] = await db.select({ key: postVideos.storageKey, poster: postVideos.posterKey, kind: postVideos.kind, at: postVideos.createdAt, slug: brands.slug, on: posts.scheduledOn, postId: posts.id })
    .from(postVideos)
    .innerJoin(posts, and(eq(posts.id, postVideos.postId), eq(posts.orgId, ctx.orgId)))
    .innerJoin(brands, and(eq(brands.id, posts.brandId), eq(brands.orgId, ctx.orgId)))
    .where(and(eq(postVideos.id, id), eq(postVideos.orgId, ctx.orgId)));
  if (!v || (o.poster && !v.poster)) throw new ImageJobError("NOT_FOUND");
  const stamp = v.at.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  const base = `${v.slug}-${v.on ?? v.postId.slice(0, 8)}-${v.kind === "persona" ? "persona-video" : "animacija"}-${stamp}`;
  return o.poster
    ? storage.presignGet(v.poster!, { filename: `${base}.jpg`, contentType: "image/jpeg", inline: !o.download })
    : storage.presignGet(v.key, { filename: `${base}.mp4`, contentType: "video/mp4", inline: !o.download });
}

/** Any member deletes a video; the files go afterwards (best effort — the row decides access). */
export async function deletePostVideo(db: Db, storage: Storage, ctx: OrgContext, id: string) {
  const [v] = (await forOrg(db, ctx).delete(postVideos, eq(postVideos.id, id))) as PostVideoRow[];
  if (!v) throw new ImageJobError("NOT_FOUND");
  await Promise.all([v.storageKey, v.posterKey].filter((k): k is string => !!k).map((k) => storage.delete(k).catch(() => undefined)));
  return v.postId;
}
