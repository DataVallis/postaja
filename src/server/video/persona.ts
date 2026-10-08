// Persona video (TASK-025, spec §5.4, ADR-055): a short vertical clip of the brand's AI influencer for one post.
// Claude writes the shot (first frame + motion) from the post and the persona's DNA; the reference model (Nano Banana
// Pro edit) makes the first frame from the passport pictures, so it is the same person; Kling 3.0 animates it; ffmpeg
// fits it to 1080×1920 with a silent track. Every paid step is reserved first and settled or released.
import { and, eq, inArray, lt, or } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { getBrandDetail } from "../brands/service";
import type { Db } from "../db/client";
import { modelRegistry, posts, usageLedger } from "../db/schema";
import { issues as zodIssues } from "../design/ai";
import { ImageError } from "../images/fal";
import { ImageJobError, type ImageDeps } from "../images/service";
import { cappedCall, textModelFor } from "../llm/call";
import { worstCaseMicroUsd } from "../llm/cost";
import { release, reserve } from "../llm/spend";
import { getBrandPersona, passportReferences, personaPicture } from "../personas/service";
import { keyframePrompt, motionPrompt, sceneRequest, sceneSchema, type Scene } from "../personas/scene";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { composeVideo, probeVideo } from "./ffmpeg";
import { addPostVideo } from "./media";
import { AI_VIDEO_METADATA } from "../images/ai-label";
import { POST_VIDEO_QUEUE } from "./service";

export const PERSONA_DURATIONS = [5, 10] as const;
export const WISH_MAX = 600;
export const VIDEO_SIZE = { width: 1080, height: 1920 } as const;
const STALE_MS = 20 * 60 * 1000;

type PostRow = typeof posts.$inferSelect;
type Queue = { send(name: string, data: object, key: string): Promise<void> };

async function defaultModel(db: Db, kind: "image_ref" | "video") {
  return (await db.select().from(modelRegistry).where(and(eq(modelRegistry.kind, kind), eq(modelRegistry.isDefault, true), eq(modelRegistry.enabled, true))))[0];
}

/** At most what one persona video costs: the scene call (with a retry), the first frame and the clip. */
export async function personaVideoEstimate(db: Db, brandId: string, durationS: number): Promise<bigint | null> {
  const [text, ref, video] = await Promise.all([textModelFor(db, brandId).catch(() => null), defaultModel(db, "image_ref"), defaultModel(db, "video")]);
  if (!text || !ref || !video) return null;
  return 2n * worstCaseMicroUsd(12_000, 1_500, text) + ref.perImage + ref.perMegapixel + video.perSecond * BigInt(durationS);
}

const requestInput = z.object({ durationS: z.union([z.literal(5), z.literal(10)]), wish: z.string().trim().max(WISH_MAX).default("") });

/** Any member. Claims the post's video for the persona (one video per post) and queues the job. */
export async function requestPersonaVideo(db: Db, queue: Queue, ctx: OrgContext, postId: string, input: z.input<typeof requestInput>) {
  const parsed = requestInput.safeParse(input);
  if (!parsed.success) throw new ImageJobError("INVALID");
  const [p] = (await forOrg(db, ctx).select(posts, eq(posts.id, postId))) as PostRow[];
  if (!p) throw new ImageJobError("NOT_FOUND");
  if (p.status === "skipped") throw new ImageJobError("BAD_STATE");
  const persona = await getBrandPersona(db, ctx, p.brandId);
  if (!persona?.images.length) throw new ImageJobError("NO_PERSONA");
  if (!(await defaultModel(db, "video")) || !(await defaultModel(db, "image_ref"))) throw new ImageJobError("NO_VIDEO_MODEL");
  const claimed = await forOrg(db, ctx).update(
    posts,
    { videoStatus: "queued", videoError: null, videoRequestedBy: ctx.userId, videoMode: "persona", videoMotion: parsed.data.wish, videoDurationS: parsed.data.durationS, videoPosition: 0, updatedAt: new Date() },
    and(eq(posts.id, postId), or(inArray(posts.videoStatus, ["none", "ready", "failed"]), and(inArray(posts.videoStatus, ["queued", "rendering"]), lt(posts.updatedAt, new Date(Date.now() - STALE_MS))))!)!,
  );
  if (!claimed.length) throw new ImageJobError("BAD_STATE");
  await queue.send(POST_VIDEO_QUEUE, { postId }, `post:${postId}:video`);
}

const key = (orgId: string, postId: string, ext: string) => `org/${orgId}/posts/${postId}/${crypto.randomUUID()}.${ext}`;

/** Claude's shot for the post (one retry with the validation errors). */
async function writeScene(db: Db, deps: Pick<ImageDeps, "llm" | "now">, ctx: OrgContext, p: PostRow, persona: NonNullable<Awaited<ReturnType<typeof getBrandPersona>>>["persona"], durationS: number): Promise<Scene> {
  const { brand, channels } = await getBrandDetail(db, ctx, p.brandId);
  const platform = channels.find((c) => c.id === p.channelId)?.platform ?? null;
  let invalid: { draft: unknown; errors: string } | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await cappedCall(db, deps.llm, { orgId: ctx.orgId, brandId: p.brandId, postId: p.id, now: deps.now }, sceneRequest({
      personaName: persona.name, dna: persona.dna, brandName: brand.name, platform, durationS,
      post: { caption: p.content?.caption ?? null, brief: p.brief, topic: p.plan?.topic ?? null }, wish: p.videoMotion ?? "",
    }, invalid));
    const parsed = sceneSchema.safeParse(out.input);
    if (parsed.success) return parsed.data;
    invalid = { draft: out.input, errors: zodIssues(parsed.error) };
  }
  throw new ImageJobError("INVALID_OUTPUT");
}

/** A transparent overlay of the video's size (nothing is burned in yet; subtitles come later). */
const emptyOverlay = () => sharp({ create: { ...VIDEO_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer().then((b) => new Uint8Array(b));

/** Makes the post's persona video as `ctx`. Throws ImageError / SpendCapError / LlmError / ImageJobError / VideoError. */
export async function makePersonaVideo(db: Db, deps: ImageDeps, ctx: OrgContext, postId: string): Promise<Scene> {
  const [p] = (await forOrg(db, ctx).select(posts, eq(posts.id, postId))) as PostRow[];
  if (!p) throw new ImageJobError("NOT_FOUND");
  const data = await getBrandPersona(db, ctx, p.brandId);
  if (!data?.images.length) throw new ImageJobError("NO_PERSONA");
  if (!deps.images?.video) throw new ImageError("NO_IMAGE_KEY");
  const videoModel = await defaultModel(db, "video");
  if (!videoModel) throw new ImageJobError("NO_VIDEO_MODEL");
  const durationS = p.videoDurationS === 10 ? 10 : 5;

  // 1. The shot. 2. The first frame: the same person from the passport pictures (primary first).
  const scene = await writeScene(db, deps, ctx, p, data.persona, durationS);
  const refs = await passportReferences(db, deps.storage, ctx, data.persona.id, 4);
  const frame = await personaPicture(db, deps, ctx, { brandId: p.brandId, postId: p.id }, keyframePrompt(data.persona.dna, scene), VIDEO_SIZE, refs);
  const keyframe = new Uint8Array(await sharp(frame.bytes).resize({ ...VIDEO_SIZE, fit: "cover" }).jpeg({ quality: 90 }).toBuffer());

  // 3. The clip: reserved at the full length, released if the provider fails, settled once delivered.
  const ledgerId = await reserve(db, { orgId: ctx.orgId, brandId: p.brandId, postId: p.id, provider: videoModel.provider, model: videoModel.modelKey, estimate: videoModel.perSecond * BigInt(durationS), now: deps.now });
  let clip: Uint8Array;
  try {
    clip = (await deps.images.video({ model: videoModel.modelKey, prompt: motionPrompt(scene), image: `data:image/jpeg;base64,${Buffer.from(keyframe).toString("base64")}`, durationS })).bytes;
  } catch (e) {
    await release(db, ledgerId);
    throw e;
  }
  await db.update(usageLedger).set({ state: "settled", costMicroUsd: videoModel.perSecond * BigInt(durationS) }).where(eq(usageLedger.id, ledgerId));

  // 4. The clip is untrusted: probed, then fitted to 1080×1920 (cover, never stretched) with a silent track.
  await probeVideo(clip);
  // TASK-045: the video shows an AI person — said in its metadata.
  const { bytes, probe } = await composeVideo(clip, await emptyOverlay(), { ...VIDEO_SIZE, maxS: durationS, metadata: AI_VIDEO_METADATA });

  const kv = key(ctx.orgId, postId, "mp4");
  const kk = key(ctx.orgId, postId, "jpg");
  await deps.storage.put(kv, bytes, "video/mp4");
  await deps.storage.put(kk, keyframe, "image/jpeg");
  // Added next to the post's earlier videos (TASK-032): nothing made before is removed.
  await addPostVideo(db, ctx, { postId, kind: "persona", storageKey: kv, posterKey: kk, width: probe.width, height: probe.height, sizeBytes: bytes.byteLength, model: videoModel.modelKey, spec: scene });
  await forOrg(db, ctx).update(posts, { videoStatus: "ready", videoError: null, updatedAt: new Date() }, eq(posts.id, postId));
  return scene;
}
