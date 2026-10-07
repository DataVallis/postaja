// Post animations (TASK-023, ADR-052; replaces TASK-022's image-to-video for posts — owner, 2026-10-07): Claude writes a
// motion spec for one finished image (how each element of the brand template enters, how the illustration drifts),
// Postaja renders it frame by frame with the same renderer as the still and encodes an MP4. No generative video model
// touches a post, so every image can be animated and every letter stays exact. Kling 3.0 (model registry, kind video)
// is kept for AI-influencer videos with a persona (phase 2).
import { and, eq, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";
import { getBrandDetail } from "../brands/service";
import type { Db } from "../db/client";
import { postMedia, posts } from "../db/schema";
import { renderTemplate } from "../design/render";
import { brandAssetBytes, getDesign } from "../design/service";
import type { DesignSpec } from "../design/spec";
import { issues as zodIssues } from "../design/ai";
import { imageFailureCode, ImageJobError, type ImageDeps } from "../images/service";
import { cappedCall, textModelFor } from "../llm/call";
import { worstCaseMicroUsd } from "../llm/cost";
import { resolveOrgContext, TenancyError, type OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { motionRequest } from "./ai";
import { encodeFrames, VideoError } from "./ffmpeg";
import { FPS, MAX_S, motionSpecSchema, specIssues, type MotionSpec } from "./motion";

export const POST_VIDEO_QUEUE = "post-video";
export type PostVideoJob = { postId: string };
export const MOTION_MAX = 600;
const STALE_MS = 15 * 60 * 1000;

type PostRow = typeof posts.$inferSelect;

/** Images of the post that can be animated: every finished image (the template is re-drawn per frame). */
export async function animatablePositions(db: Db, ctx: OrgContext, p: Pick<PostRow, "id" | "visual">): Promise<number[]> {
  if (!p.visual) return [];
  const slides = await db.select({ position: postMedia.position }).from(postMedia)
    .where(and(eq(postMedia.orgId, ctx.orgId), eq(postMedia.postId, p.id), eq(postMedia.kind, "slide")));
  const have = new Set(slides.map((s) => s.position));
  return p.visual.slides.map((_, i) => i).filter((i) => have.has(i));
}

/** At most what one animation costs: the motion-spec call (with one retry) at the brand's Claude model. */
export async function animationEstimate(db: Db, brandId: string): Promise<bigint | null> {
  const model = await textModelFor(db, brandId).catch(() => null);
  return model ? 2n * worstCaseMicroUsd(9_000, 2_500, model) : null;
}

const requestInput = z.object({ position: z.number().int().min(0).max(19), motion: z.string().trim().max(MOTION_MAX).default("") });

/** Any member. Claims the post's video (one at a time) and queues the job. `motion` is the owner's optional wish. */
export async function requestAnimation(db: Db, queue: { send(name: string, data: object, key: string): Promise<void> }, ctx: OrgContext, postId: string, input: z.input<typeof requestInput>) {
  const parsed = requestInput.safeParse(input);
  if (!parsed.success) throw new ImageJobError("INVALID");
  const { position, motion } = parsed.data;
  const [p] = (await forOrg(db, ctx).select(posts, eq(posts.id, postId))) as PostRow[];
  if (!p) throw new ImageJobError("NOT_FOUND");
  if (p.status === "skipped" || p.mediaStatus !== "ready") throw new ImageJobError("BAD_STATE");
  if (!(await animatablePositions(db, ctx, p)).includes(position)) throw new ImageJobError("NOT_ANIMATABLE");
  const claimed = await forOrg(db, ctx).update(
    posts,
    { videoStatus: "queued", videoError: null, videoRequestedBy: ctx.userId, videoMotion: motion, videoPosition: position, updatedAt: new Date() },
    and(eq(posts.id, postId), or(inArray(posts.videoStatus, ["none", "ready", "failed"]), and(inArray(posts.videoStatus, ["queued", "rendering"]), lt(posts.updatedAt, new Date(Date.now() - STALE_MS))))!)!,
  );
  if (!claimed.length) throw new ImageJobError("BAD_STATE");
  await queue.send(POST_VIDEO_QUEUE, { postId } satisfies PostVideoJob, `post:${postId}:video`);
}

const key = (orgId: string, postId: string) => `org/${orgId}/posts/${postId}/${crypto.randomUUID()}.mp4`;

/** Makes the post's animation as `ctx`. Throws SpendCapError / LlmError / ImageJobError / VideoError for expected outcomes. */
export async function animatePost(db: Db, deps: Omit<ImageDeps, "images">, ctx: OrgContext, postId: string) {
  const [p] = (await forOrg(db, ctx).select(posts, eq(posts.id, postId))) as PostRow[];
  if (!p) throw new ImageJobError("NOT_FOUND");
  const position = p.videoPosition ?? 0;
  if (!(await animatablePositions(db, ctx, p)).includes(position)) throw new ImageJobError("NOT_ANIMATABLE");
  // The design version that made the images (the brand may have moved on since).
  const design = await getDesign(db, ctx, p.visual!.designId);
  const spec = design.spec as DesignSpec;
  const slide = p.visual!.slides[position];
  const t = spec.templates.find((x) => x.id === slide.templateId);
  if (!t) throw new ImageJobError("NOT_ANIMATABLE");
  const media = (await forOrg(db, ctx).select(postMedia, eq(postMedia.postId, postId))) as (typeof postMedia.$inferSelect)[];
  const still = media.find((m) => m.kind === "slide" && m.position === position)!;
  const bg = media.find((m) => m.kind === "background" && m.position === position);
  const size = { width: still.width, height: still.height };
  const { channels } = await getBrandDetail(db, ctx, p.brandId);
  const platform = channels.find((c) => c.id === p.channelId)?.platform ?? null;

  // Claude's motion spec, checked against the template (one retry with the problems).
  let motion: MotionSpec | null = null;
  let invalid: { draft: unknown; errors: string } | undefined;
  for (let attempt = 0; attempt < 2 && !motion; attempt++) {
    const out = await cappedCall(db, deps.llm, { orgId: ctx.orgId, brandId: p.brandId, postId: p.id, now: deps.now },
      motionRequest({ spec, template: t, slots: slide.slots, instruction: p.videoMotion ?? "", platform }, invalid));
    const parsed = motionSpecSchema.safeParse(out.input);
    if (!parsed.success) { invalid = { draft: out.input, errors: zodIssues(parsed.error) }; continue; }
    const problems = specIssues(parsed.data, t.elements.length);
    if (problems.length) { invalid = { draft: out.input, errors: problems.map((x) => `- ${x}`).join("\n") }; continue; }
    motion = parsed.data;
  }
  if (!motion) throw new ImageJobError("INVALID_OUTPUT");

  // Frame by frame with the still's own renderer; pictures are fitted once and reused.
  const assets = await brandAssetBytes(db, deps.storage, ctx, p.brandId);
  const illustration = bg ? await deps.storage.get(bg.storageKey) : null;
  const cache = new Map<string, string>();
  const count = Math.round(Math.min(motion.durationS, MAX_S) * FPS);
  const { bytes, probe } = await encodeFrames(count, (i) => renderTemplate(spec, t, size, {
    slots: slide.slots, illustration, logo: assets.logo, brandFont: assets.font, motion: { spec: motion!, t: i / FPS }, cache,
  }), { ...size, fps: FPS });

  const k = key(ctx.orgId, postId);
  await deps.storage.put(k, bytes, "video/mp4");
  const old = media.filter((m) => m.kind === "video");
  await db.transaction(async (tx) => {
    const s = forOrg(tx as unknown as Db, ctx);
    if (old.length) await s.delete(postMedia, inArray(postMedia.id, old.map((m) => m.id)));
    // The motion spec is kept with the video (prompt column), so it can be inspected or re-rendered later.
    await s.insert(postMedia, { id: crypto.randomUUID(), postId, kind: "video", position, storageKey: k, contentType: "video/mp4", width: probe.width, height: probe.height, sizeBytes: bytes.byteLength, model: "postaja-motion", prompt: JSON.stringify(motion) });
    await s.update(posts, { videoStatus: "ready", videoError: null, updatedAt: new Date() }, eq(posts.id, postId));
  });
  await Promise.all(old.map((m) => deps.storage.delete(m.storageKey).catch(() => undefined)));
  return motion;
}

/** Worker side: acts as the member who asked (re-verified); expected failures are recorded on the post. */
export async function runVideoJob(db: Db, deps: Omit<ImageDeps, "images">, job: PostVideoJob): Promise<"done" | "skipped" | "failed"> {
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
