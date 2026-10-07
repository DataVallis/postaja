// Animation (TASK-022, spec §5.6, ADR-051): one image of a post comes alive. The image model only ever sees the clean
// illustration (no text); an image-to-video model on fal moves it as the motion prompt says; Postaja burns the
// template's words, logo and shapes back on with ffmpeg (ADR-021) at the slide's exact size. One video per post.
import { and, eq, inArray, lt, or } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import type { Db } from "../db/client";
import { modelRegistry, postMedia, posts, usageLedger } from "../db/schema";
import { renderTemplate } from "../design/render";
import { brandAssetBytes, currentDesign } from "../design/service";
import type { DesignSpec, Template } from "../design/spec";
import { imageFailureCode, ImageJobError, type ImageDeps } from "../images/service";
import { ImageError } from "../images/fal";
import { release, reserve } from "../llm/spend";
import { resolveOrgContext, TenancyError, type OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { composeVideo, probeVideo, VideoError } from "./ffmpeg";

export const POST_VIDEO_QUEUE = "post-video";
export type PostVideoJob = { postId: string };
/** Clip length asked from the model (Hailuo: 6 or 10 s); the post's video is this long. */
export const VIDEO_SECONDS = 6;
export const MOTION_MAX = 600;
const STALE_MS = 15 * 60 * 1000;

type PostRow = typeof posts.$inferSelect;

/** Only templates whose illustration fills the whole canvas can be animated: the clip replaces it, the rest goes on top. */
export const animatableTemplate = (t: Template | undefined) => !!t && t.background.type === "illustration";

/** Positions of a post's images that can be animated: a full-bleed illustration that was generated and stored. */
export async function animatablePositions(db: Db, ctx: OrgContext, p: Pick<PostRow, "id" | "brandId" | "visual">): Promise<number[]> {
  if (!p.visual) return [];
  const design = await currentDesign(db, ctx, p.brandId);
  if (!design?.spec || design.id !== p.visual.designId) return [];
  const bg = await db.select({ position: postMedia.position }).from(postMedia)
    .where(and(eq(postMedia.orgId, ctx.orgId), eq(postMedia.postId, p.id), eq(postMedia.kind, "background")));
  const have = new Set(bg.map((b) => b.position));
  return p.visual.slides.flatMap((s, i) => (have.has(i) && animatableTemplate(design.spec!.templates.find((t) => t.id === s.templateId)) ? [i] : []));
}

/** A starting motion prompt from the image's illustration subject; the owner edits it before animating. */
export function defaultMotion(illustration: string | null | undefined): string {
  const scene = (illustration ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
  return `Slow, smooth camera push-in. Gentle, natural motion in the scene${scene ? `: ${scene}` : ""}. Keep the composition and lighting; no cuts, no new objects.`;
}

/** The default video model and what one clip costs (micro-USD). */
export async function videoModel(db: Db) {
  const [m] = await db.select().from(modelRegistry).where(and(eq(modelRegistry.kind, "video"), eq(modelRegistry.isDefault, true), eq(modelRegistry.enabled, true)));
  return m ? { ...m, clipPrice: m.perSecond * BigInt(VIDEO_SECONDS) + m.perImage } : null;
}

const requestInput = z.object({ position: z.number().int().min(0).max(19), motion: z.string().trim().min(3).max(MOTION_MAX) });

/** Any member. Claims the post's video (one at a time) and queues the job. */
export async function requestAnimation(db: Db, queue: { send(name: string, data: object, key: string): Promise<void> }, ctx: OrgContext, postId: string, input: z.input<typeof requestInput>) {
  const parsed = requestInput.safeParse(input);
  if (!parsed.success) throw new ImageJobError("INVALID");
  const { position, motion } = parsed.data;
  const [p] = (await forOrg(db, ctx).select(posts, eq(posts.id, postId))) as PostRow[];
  if (!p) throw new ImageJobError("NOT_FOUND");
  if (p.status === "skipped" || p.mediaStatus !== "ready") throw new ImageJobError("BAD_STATE");
  if (!(await animatablePositions(db, ctx, p)).includes(position)) throw new ImageJobError("NOT_ANIMATABLE");
  if (!(await videoModel(db))) throw new ImageJobError("NO_VIDEO_MODEL");
  const claimed = await forOrg(db, ctx).update(
    posts,
    { videoStatus: "queued", videoError: null, videoRequestedBy: ctx.userId, videoMotion: motion, videoPosition: position, updatedAt: new Date() },
    and(eq(posts.id, postId), or(inArray(posts.videoStatus, ["none", "ready", "failed"]), and(inArray(posts.videoStatus, ["queued", "rendering"]), lt(posts.updatedAt, new Date(Date.now() - STALE_MS))))!)!,
  );
  if (!claimed.length) throw new ImageJobError("BAD_STATE");
  await queue.send(POST_VIDEO_QUEUE, { postId } satisfies PostVideoJob, `post:${postId}:video`);
}

const key = (orgId: string, postId: string) => `org/${orgId}/posts/${postId}/${crypto.randomUUID()}.mp4`;

/** Makes the post's video as `ctx`. Throws ImageError / SpendCapError / ImageJobError / VideoError for expected outcomes. */
export async function animatePost(db: Db, deps: ImageDeps, ctx: OrgContext, postId: string) {
  const [p] = (await forOrg(db, ctx).select(posts, eq(posts.id, postId))) as PostRow[];
  if (!p) throw new ImageJobError("NOT_FOUND");
  const position = p.videoPosition ?? 0;
  if (!(await animatablePositions(db, ctx, p)).includes(position)) throw new ImageJobError("NOT_ANIMATABLE");
  if (!deps.images?.video) throw new ImageError("NO_IMAGE_KEY");
  const model = await videoModel(db);
  if (!model) throw new ImageJobError("NO_VIDEO_MODEL");
  const design = (await currentDesign(db, ctx, p.brandId))!;
  const spec = design.spec as DesignSpec;
  const slide = p.visual!.slides[position];
  const t = spec.templates.find((x) => x.id === slide.templateId)!;
  const media = (await forOrg(db, ctx).select(postMedia, eq(postMedia.postId, postId))) as (typeof postMedia.$inferSelect)[];
  const bg = media.find((m) => m.kind === "background" && m.position === position)!;
  const finished = media.find((m) => m.kind === "slide" && m.position === position);
  const size = finished ? { width: finished.width, height: finished.height } : { width: 1080, height: 1350 };

  // The clean illustration, at most 1280 px on its long side (the model's input; well under its 20 MB limit).
  const clean = await sharp(await deps.storage.get(bg.storageKey)).resize(1280, 1280, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  const prompt = `${p.videoMotion || defaultMotion(slide.illustration)} No text, letters, logos or watermarks.`;
  const ledgerId = await reserve(db, { orgId: ctx.orgId, brandId: p.brandId, postId: p.id, provider: model.provider, model: model.modelKey, estimate: model.clipPrice, now: deps.now });
  let clip: Uint8Array;
  try {
    clip = (await deps.images.video({ model: model.modelKey, prompt, image: `data:image/jpeg;base64,${clean.toString("base64")}`, durationS: VIDEO_SECONDS })).bytes;
  } catch (e) {
    await release(db, ledgerId);
    throw e;
  }
  // Billed once the provider delivered, even if the clip then fails our checks (the provider charged for it).
  await db.update(usageLedger).set({ state: "settled", costMicroUsd: model.clipPrice }).where(eq(usageLedger.id, ledgerId));
  await probeVideo(clip);
  const assets = await brandAssetBytes(db, deps.storage, ctx, p.brandId);
  const overlay = await renderTemplate(spec, t, size, { slots: slide.slots, logo: assets.logo, brandFont: assets.font, overlayOnly: true });
  const { bytes, probe } = await composeVideo(clip, overlay, { ...size, maxS: VIDEO_SECONDS });
  const k = key(ctx.orgId, postId);
  await deps.storage.put(k, bytes, "video/mp4");
  const old = media.filter((m) => m.kind === "video");
  await db.transaction(async (tx) => {
    const s = forOrg(tx as unknown as Db, ctx);
    if (old.length) await s.delete(postMedia, inArray(postMedia.id, old.map((m) => m.id)));
    await s.insert(postMedia, { id: crypto.randomUUID(), postId, kind: "video", position, storageKey: k, contentType: "video/mp4", width: probe.width, height: probe.height, sizeBytes: bytes.byteLength, model: model.modelKey, prompt });
    await s.update(posts, { videoStatus: "ready", videoError: null, updatedAt: new Date() }, eq(posts.id, postId));
  });
  await Promise.all(old.map((m) => deps.storage.delete(m.storageKey).catch(() => undefined)));
}

/** Worker side: acts as the member who asked (re-verified); expected failures are recorded on the post. */
export async function runVideoJob(db: Db, deps: ImageDeps, job: PostVideoJob): Promise<"done" | "skipped" | "failed"> {
  const [p] = await db.select({ id: posts.id, orgId: posts.orgId, by: posts.videoRequestedBy }).from(posts).where(eq(posts.id, job.postId));
  if (!p) return "skipped";
  const claimed = await db.update(posts).set({ videoStatus: "rendering", updatedAt: new Date() }).where(and(eq(posts.id, p.id), eq(posts.videoStatus, "queued"))).returning({ id: posts.id });
  if (!claimed.length) return "skipped";
  const fail = async (code: string) => {
    await db.update(posts).set({ videoStatus: "failed", videoError: code.slice(0, 300), updatedAt: new Date() }).where(eq(posts.id, p.id));
    return "failed" as const;
  };
  if (!p.by) return fail("NO_ACCESS");
  let ctx: OrgContext;
  try {
    ctx = await resolveOrgContext(db, { userId: p.by, activeOrganizationId: p.orgId });
  } catch (e) {
    if (e instanceof TenancyError) return fail("NO_ACCESS");
    throw e;
  }
  try {
    await animatePost(db, deps, ctx, p.id);
    return "done";
  } catch (e) {
    if (e instanceof VideoError) return fail(e.code);
    const code = imageFailureCode(e);
    if (code) return fail(code);
    await db.update(posts).set({ videoStatus: "queued" }).where(and(eq(posts.id, p.id), eq(posts.videoStatus, "rendering")));
    throw e;
  }
}

/** The post's video row (members of the org), or null. */
export async function postVideo(db: Db, ctx: OrgContext, postId: string) {
  const [m] = await db.select({ id: postMedia.id, position: postMedia.position, width: postMedia.width, height: postMedia.height, sizeBytes: postMedia.sizeBytes })
    .from(postMedia).where(and(eq(postMedia.orgId, ctx.orgId), eq(postMedia.postId, postId), eq(postMedia.kind, "video")));
  return m ?? null;
}
