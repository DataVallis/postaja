// Reel from several shots (TASK-058, ADR-087). Claude plans 2–4 shots; each run of consecutive scenes gets one first
// frame (an illustration in the brand's style, checked for made-up writing and drawn again when it has some) and one
// Kling 3.0 call with one prompt per shot; a "screen" shows one of the owner's reference pictures as it is; captions
// and the closing card (the post's own image, laid out again for 9:16) are set by Postaja in the brand's fonts; ffmpeg
// joins it all into one 1080×1920 MP4. Every paid step is reserved first and settled or released.
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { requireFeature } from "../billing/features";
import { getBrandDetail } from "../brands/service";
import type { Db } from "../db/client";
import { modelRegistry, postMedia, posts, usageLedger } from "../db/schema";
import { issues as zodIssues } from "../design/ai";
import { renderTemplate } from "../design/render";
import { brandAssetBytes, brandExamples, currentDesign } from "../design/service";
import { color, type DesignSpec, type Template } from "../design/spec";
import { MAX_INPUT_PIXELS } from "../files/images";
import { ImageError } from "../images/fal";
import { generateIllustration, illustrationPrompt, ImageJobError, type ImageDeps } from "../images/service";
import { loadReferences, mentionedReferences, referenceChoices, type ReferenceImage } from "../images/references";
import { postLanguage } from "@/lib/language";
import { cappedCall, textModelFor } from "../llm/call";
import { worstCaseMicroUsd } from "../llm/cost";
import { release, reserve } from "../llm/spend";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { composeVideo, concatVideos, encodeFrames, probeVideo } from "./ffmpeg";
import { addPostVideo } from "./media";
import { POST_VIDEO_QUEUE, type PostVideoJob } from "./service";
import { clipSeconds, klingShotPrompt, REEL_DURATIONS, REEL_WISH_MAX, reelIssues, reelRequest, reelSchema, sceneGroups, type ReelPlan } from "./reel-ai";

export const REEL_SIZE = { width: 1080, height: 1920 } as const;
/** Instagram / Facebook reel safe zone (format preset ig_reel): captions stay out of the UI. */
export const REEL_SAFE = { top: 270, right: 65, bottom: 672, left: 65 } as const;
/** The closing card: the post's own image, a little longer than a glance. */
export const END_CARD_S = 2.5;
const FPS = 25;
const STALE_MS = 30 * 60 * 1000;

type PostRow = typeof posts.$inferSelect;
type Queue = { send(name: string, data: object, key: string): Promise<void> };

async function defaultModel(db: Db, kind: "image" | "video") {
  return (await db.select().from(modelRegistry).where(and(eq(modelRegistry.kind, kind), eq(modelRegistry.isDefault, true), eq(modelRegistry.enabled, true))))[0];
}

/** At most what one reel costs: the plan (with a retry), up to 4 first frames (each maybe twice) and the video seconds. */
export async function reelEstimate(db: Db, brandId: string, durationS: number): Promise<bigint | null> {
  const [text, image, video] = await Promise.all([textModelFor(db, brandId).catch(() => null), defaultModel(db, "image"), defaultModel(db, "video")]);
  if (!text || !image || !video) return null;
  const frame = image.perImage + 2n * image.perMegapixel;
  return 2n * worstCaseMicroUsd(14_000, 2_500, text) + 8n * frame + 4n * worstCaseMicroUsd(2_000, 200, text) + video.perSecond * BigInt(durationS + 2);
}

const requestInput = z.object({ durationS: z.union([z.literal(8), z.literal(12), z.literal(15)]).default(12), wish: z.string().trim().max(REEL_WISH_MAX).default("") });

/** Any member (Studio and Agencija: the animation feature). Claims the post's video and queues the reel. */
export async function requestReel(db: Db, queue: Queue, ctx: OrgContext, postId: string, input: z.input<typeof requestInput>) {
  await requireFeature(db, ctx, "animation");
  const parsed = requestInput.safeParse(input);
  if (!parsed.success || !(REEL_DURATIONS as readonly number[]).includes(parsed.data.durationS)) throw new ImageJobError("INVALID");
  const [p] = (await forOrg(db, ctx).select(posts, eq(posts.id, postId))) as PostRow[];
  if (!p) throw new ImageJobError("NOT_FOUND");
  if (p.status === "skipped") throw new ImageJobError("BAD_STATE");
  if (!(await currentDesign(db, ctx, p.brandId))) throw new ImageJobError("NO_DESIGN");
  if (!(await defaultModel(db, "video")) || !(await defaultModel(db, "image"))) throw new ImageJobError("NO_VIDEO_MODEL");
  const claimed = await forOrg(db, ctx).update(
    posts,
    { videoStatus: "queued", videoError: null, videoRequestedBy: ctx.userId, videoMode: "reel", videoMotion: parsed.data.wish, videoDurationS: parsed.data.durationS, videoPosition: 0, updatedAt: new Date() },
    and(eq(posts.id, postId), or(inArray(posts.videoStatus, ["none", "ready", "failed"]), and(inArray(posts.videoStatus, ["queued", "rendering"]), lt(posts.updatedAt, new Date(Date.now() - STALE_MS))))!)!,
  );
  if (!claimed.length) throw new ImageJobError("BAD_STATE");
  await queue.send(POST_VIDEO_QUEUE, { postId } satisfies PostVideoJob, `post:${postId}:video`);
}

const key = (orgId: string, postId: string, ext: string) => `org/${orgId}/posts/${postId}/${crypto.randomUUID()}.${ext}`;

/** Claude's shots (one retry with the problems). */
async function planReel(db: Db, deps: Pick<ImageDeps, "llm" | "now">, ctx: OrgContext, p: PostRow, spec: DesignSpec, refs: ReferenceImage[], durationS: number): Promise<ReelPlan> {
  const { brand, channels } = await getBrandDetail(db, ctx, p.brandId);
  const channel = channels.find((c) => c.id === p.channelId) ?? null;
  let invalid: { draft: unknown; errors: string } | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await cappedCall(db, deps.llm, { orgId: ctx.orgId, brandId: p.brandId, postId: p.id, now: deps.now }, {
      ...reelRequest({
        brandName: brand.name, language: postLanguage(channel?.language, brand.languages), platform: channel?.platform ?? null, durationS,
        post: { caption: p.content?.caption ?? null, brief: p.brief, topic: p.plan?.topic ?? null, imagePrompt: p.plan?.imagePrompt?.trim() || null, overlayText: p.plan?.overlayText?.trim() || null },
        references: refs.map((r) => r.name), style: spec.illustrationStyle, wish: p.videoMotion ?? "",
      }, invalid),
      ...(refs.length ? { images: refs.map((r) => r.block) } : {}),
    });
    const parsed = reelSchema.safeParse(out.input);
    const problems = parsed.success ? reelIssues(parsed.data, refs.length, durationS) : [];
    if (parsed.success && (!problems.length || attempt === 1) && !problems.some((x) => x.includes("does not exist") || x.includes("must be a scene"))) return parsed.data;
    invalid = { draft: out.input, errors: parsed.success ? problems.join("\n") : zodIssues(parsed.error) };
  }
  throw new ImageJobError("INVALID_OUTPUT");
}

/**
 * Captions (shots and screens): the brand's heading font and colours on a chip at the top of the safe box, so they
 * read over any picture without darkening the whole video.
 */
const CAPTION_H = 24;
export const CAPTION_TEMPLATE: Template = {
  id: "reel-caption", name: "Reel caption", use: "reel captions", sample: {},
  background: { type: "color", color: "background", angle: 180 },
  elements: [{
    type: "text", x: 4, y: 0, w: 92, h: CAPTION_H, slot: "headline", font: "heading", weight: 700, color: "text", emphasis: "accent",
    maxSize: 7, minSize: 4, align: "center", valign: "top", uppercase: false, lineHeight: 1.1, letterSpacing: 0, fill: "background", padding: 2.5, radius: 3, opacity: 1,
  }],
};
const clear = () => sharp({ create: { ...REEL_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer().then((b) => new Uint8Array(b));

/** The caption of a shot as a transparent overlay in the brand's fonts (nothing when empty or no fitting template). */
async function captionOverlay(spec: DesignSpec, caption: string, font: Uint8Array | null): Promise<Uint8Array> {
  if (!caption.trim()) return clear();
  return renderTemplate(spec, CAPTION_TEMPLATE, REEL_SIZE, { slots: { headline: caption.trim() }, overlayOnly: true, brandFont: font, safe: REEL_SAFE, logo: null });
}

/** A still picture as a clip with a slow push-in (frames drawn by sharp, encoded with a silent track). */
async function stillClip(png: Uint8Array, durationS: number): Promise<Uint8Array> {
  const base = sharp(png, { limitInputPixels: MAX_INPUT_PIXELS }).resize(REEL_SIZE.width, REEL_SIZE.height, { fit: "cover" });
  const raw = await base.png().toBuffer();
  const count = Math.max(1, Math.round(durationS * FPS));
  const { bytes } = await encodeFrames(count, async (i) => {
    const z = 1 + 0.05 * (i / Math.max(1, count - 1));
    const w = Math.round(REEL_SIZE.width * z), h = Math.round(REEL_SIZE.height * z);
    return new Uint8Array(await sharp(raw).resize(w, h).extract({ left: Math.floor((w - REEL_SIZE.width) / 2), top: Math.floor((h - REEL_SIZE.height) / 2), width: REEL_SIZE.width, height: REEL_SIZE.height }).png({ compressionLevel: 1 }).toBuffer());
  }, { ...REEL_SIZE, fps: FPS });
  return bytes;
}

/** A screen shot: the owner's picture whole (never cropped, never dimmed) on the brand's background, under its caption. */
async function screenFrame(spec: DesignSpec, ref: ReferenceImage, caption: string, font: Uint8Array | null): Promise<Uint8Array> {
  const pic = Buffer.from(ref.dataUri.split(",")[1], "base64");
  const safeH = REEL_SIZE.height - REEL_SAFE.top - REEL_SAFE.bottom;
  const top = caption.trim() ? Math.round(REEL_SAFE.top + (CAPTION_H / 100) * safeH) : REEL_SAFE.top - 120;
  const box = { width: REEL_SIZE.width - 2 * 80, height: REEL_SIZE.height - 260 - top };
  const fitted = await sharp(pic).resize({ ...box, fit: "inside" }).png().toBuffer({ resolveWithObject: true });
  return new Uint8Array(await sharp({ create: { ...REEL_SIZE, channels: 4, background: color(spec, "background") } }).composite([
    { input: fitted.data, left: Math.round((REEL_SIZE.width - fitted.info.width) / 2), top: Math.round(top + (box.height - fitted.info.height) / 2) },
    { input: Buffer.from(await captionOverlay(spec, caption, font)), left: 0, top: 0 },
  ]).png().toBuffer());
}

/** The closing card: the post's first image laid out again at 9:16 from its own template, words and illustration. */
async function endCard(db: Db, deps: Pick<ImageDeps, "storage">, ctx: OrgContext, p: PostRow, spec: DesignSpec, assets: Awaited<ReturnType<typeof brandAssetBytes>>): Promise<Uint8Array | null> {
  const slide = p.visual?.slides[0];
  const t = slide && spec.templates.find((x) => x.id === slide.templateId);
  if (!slide || !t) return null;
  const [bg] = (await forOrg(db, ctx).select(postMedia, and(eq(postMedia.postId, p.id), eq(postMedia.kind, "background"), eq(postMedia.position, 0), isNull(postMedia.archivedAt))!)) as (typeof postMedia.$inferSelect)[];
  const illustration = bg ? await deps.storage.get(bg.storageKey) : null;
  return renderTemplate(spec, t, REEL_SIZE, { slots: slide.slots, illustration, logo: assets.logo, brandFont: assets.font, safe: REEL_SAFE });
}

/**
 * A refusal by the provider's content checker, said with the shots it concerns ("1–2") and the provider's reason, so the
 * member knows what to change in the directions (owner, 2026-10-13: "Ponudnik je opis slike zavrnil … hmm").
 */
async function blocked<T>(code: "REEL_FRAME_BLOCKED" | "REEL_VIDEO_BLOCKED", start: number, count: number, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ImageError && e.code === "IMAGE_BLOCKED") {
      const shots = count > 1 ? `${start + 1}–${start + count}` : `${start + 1}`;
      throw new ImageError(code, `${shots}${e.detail ? ` · ${e.detail}` : ""}`);
    }
    throw e;
  }
}

/** Makes the post's reel as `ctx`. Throws ImageError / SpendCapError / LlmError / ImageJobError / VideoError. */
export async function makeReel(db: Db, deps: ImageDeps, ctx: OrgContext, postId: string): Promise<ReelPlan> {
  const [p] = (await forOrg(db, ctx).select(posts, eq(posts.id, postId))) as PostRow[];
  if (!p) throw new ImageJobError("NOT_FOUND");
  const design = await currentDesign(db, ctx, p.brandId);
  if (!design?.spec) throw new ImageJobError("NO_DESIGN");
  if (!deps.images?.video) throw new ImageError("NO_IMAGE_KEY");
  const videoModel = await defaultModel(db, "video");
  if (!videoModel) throw new ImageJobError("NO_VIDEO_MODEL");
  const spec = design.spec;
  const durationS = (REEL_DURATIONS as readonly number[]).includes(p.videoDurationS ?? 0) ? p.videoDurationS! : 12;
  const who = { brandId: p.brandId, postId: p.id };

  // 1. The shots, with the brand's reference pictures (reference pictures first, then image materials) to show.
  // Pictures the owner's directions tag as @file-name come first (logos only when tagged).
  const pictures = await referenceChoices(db, ctx, p.brandId);
  const tagged = mentionedReferences(p.videoMotion ?? "", pictures);
  const choices = [...pictures.filter((c) => tagged.includes(c.key)), ...pictures.filter((c) => c.kind !== "logo" && !tagged.includes(c.key))].slice(0, 4);
  const refs = await loadReferences(db, deps.storage, ctx, p.brandId, choices.map((c) => c.key));
  const plan = await planReel(db, deps, ctx, p, spec, refs, durationS);

  const assets = await brandAssetBytes(db, deps.storage, ctx, p.brandId);
  const examples = (await brandExamples(db, deps.storage, ctx, p.brandId, 4)).map((b) => `data:image/jpeg;base64,${Buffer.from(b).toString("base64")}`);
  const parts: Uint8Array[] = new Array(plan.shots.length);
  let poster: Uint8Array | null = null;

  // 2. Scenes: one first frame and one Kling call per run of consecutive scenes, then cut into its shots.
  for (const g of sceneGroups(plan.shots)) {
    const first = g.scenes[0];
    const frame = await blocked("REEL_FRAME_BLOCKED", g.start, g.scenes.length, () => generateIllustration(db, deps, ctx, who, `${illustrationPrompt(first.firstFrame, spec)}\nVertical 9:16, a real-looking photo or the brand's picture style.`, REEL_SIZE, examples, { check: true }));
    const start = new Uint8Array(await sharp(frame.bytes).resize({ ...REEL_SIZE, fit: "cover" }).jpeg({ quality: 90 }).toBuffer());
    poster ??= start;
    const seconds = clipSeconds(g.scenes);
    const ledgerId = await reserve(db, { orgId: ctx.orgId, brandId: p.brandId, postId: p.id, provider: videoModel.provider, model: videoModel.modelKey, estimate: videoModel.perSecond * BigInt(seconds), now: deps.now, action: "reel_second", units: seconds });
    let clip: Uint8Array;
    try {
      const video = deps.images.video;
      clip = (await blocked("REEL_VIDEO_BLOCKED", g.start, g.scenes.length, () => video({
        model: videoModel.modelKey, image: `data:image/jpeg;base64,${Buffer.from(start).toString("base64")}`, durationS: seconds,
        prompt: klingShotPrompt(g.scenes.map((s) => s.motion).join(" Then: ")),
        ...(g.scenes.length > 1 ? { shots: g.scenes.map((s, k) => ({ prompt: klingShotPrompt(k === 0 ? s.motion : `${s.motion} (${s.firstFrame})`), durationS: s.durationS })) } : {}),
      }))).bytes;
    } catch (e) {
      await release(db, ledgerId);
      throw e;
    }
    await db.update(usageLedger).set({ state: "settled", costMicroUsd: videoModel.perSecond * BigInt(seconds) }).where(eq(usageLedger.id, ledgerId));
    await probeVideo(clip);
    let at = 0;
    for (const [k, s] of g.scenes.entries()) {
      const overlay = await captionOverlay(spec, s.caption, assets.font);
      parts[g.start + k] = (await composeVideo(clip, overlay, { ...REEL_SIZE, maxS: s.durationS, startS: at })).bytes;
      at += s.durationS;
    }
  }

  // 3. Screens: the owner's picture as it is, with its caption.
  for (const [i, s] of plan.shots.entries()) {
    if (s.kind !== "screen") continue;
    parts[i] = await stillClip(await screenFrame(spec, refs[s.reference - 1], s.caption, assets.font), s.durationS);
  }

  // 4. The closing card, then everything joined.
  const card = await endCard(db, deps, ctx, p, spec, assets);
  const all = [...parts, ...(card ? [await stillClip(card, END_CARD_S)] : [])];
  const { bytes, probe } = await concatVideos(all, REEL_SIZE);

  const kv = key(ctx.orgId, postId, "mp4");
  const kk = key(ctx.orgId, postId, "jpg");
  await deps.storage.put(kv, bytes, "video/mp4");
  if (poster) await deps.storage.put(kk, poster, "image/jpeg");
  await addPostVideo(db, ctx, { postId, kind: "reel", storageKey: kv, posterKey: poster ? kk : null, width: probe.width, height: probe.height, sizeBytes: bytes.byteLength, model: videoModel.modelKey, spec: plan });
  await forOrg(db, ctx).update(posts, { videoStatus: "ready", videoError: null, updatedAt: new Date() }, eq(posts.id, postId));
  return plan;
}
