// Post images (TASK-015/017, ADR-043/044): a member asks for images → the post is claimed (media_status queued) and a
// job is queued → the worker asks Claude which of the brand's templates each image uses, with what words and what
// illustration (the brand's common thread); fal.ai makes the illustrations in the brand's style (its past posts as
// reference); Postaja renders every image → PNGs in S3 + post_media rows. "Osveži tekst" re-renders the edited words on
// the stored illustrations at no image cost.
import { and, asc, eq, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { brands, formatPresets, modelRegistry, posts, postMedia, usageLedger, type Platform, type PostVisual } from "../db/schema";
import { getBrandDetail } from "../brands/service";
import { postVisualRequest, postVisualSchema, issues } from "../design/ai";
import { renderTemplate } from "../design/render";
import { brandAssetBytes, brandExamples, currentDesign } from "../design/service";
import { needsIllustration, SLOTS, type DesignSpec, type Template } from "../design/spec";
import type { Storage } from "../files/storage";
import { cappedCall } from "../llm/call";
import { reserve, release, SpendCapError } from "../llm/spend";
import { LlmError, type LlmClient } from "../llm/types";
import { resolveOrgContext, TenancyError, type OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { billedMegapixels, generationSize, ImageError, type ImageClient } from "./fal";

export const POST_IMAGE_QUEUE = "post-image";
export type ImageMode = "new" | "text";
export type PostImageJob = { postId: string; mode: ImageMode };
export { MAX_SLIDES } from "../design/ai";

export class ImageJobError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "BAD_STATE" | "INVALID" | "NO_DESIGN" | "INVALID_OUTPUT") {
    super(code);
  }
}

export type ImageDeps = { llm: LlmClient; images: ImageClient | null; storage: Storage; now?: Date };

/** Feed sizes when a channel has no image preset of its own (ADR-022 presets). */
const PLATFORM_DEFAULT: Partial<Record<Platform, string>> = {
  instagram: "ig_feed_portrait", facebook: "fb_feed_portrait", linkedin: "li_feed_portrait", x: "x_landscape", tiktok: "tiktok_photo", google_display: "gdn_responsive_square",
};

export async function slideSize(db: Db, platform: Platform | null, presetKey: string | null): Promise<{ width: number; height: number; preset: string | null }> {
  for (const key of [presetKey, platform ? PLATFORM_DEFAULT[platform] : undefined]) {
    if (!key) continue;
    const [p] = await db.select().from(formatPresets).where(and(eq(formatPresets.key, key), eq(formatPresets.media, "image"), eq(formatPresets.enabled, true)));
    if (p) return { width: p.width, height: p.height, preset: p.key };
  }
  return { width: 1080, height: 1080, preset: null };
}

/** What the image model gets: Claude's subject, the design's illustration style, never letters (ADR-009). */
export function illustrationPrompt(subject: string, spec: DesignSpec): string {
  return [subject.trim().slice(0, 1500), `Style: ${spec.illustrationStyle}`, "No text, no letters, no numbers, no logos, no watermarks."].join("\n");
}

/** The illustration's shape: the whole slide for a full-bleed background, else the image box of the template. */
export function illustrationShape(t: Template, size: { width: number; height: number }) {
  if (t.background.type === "illustration") return size;
  const box = t.elements.find((e) => e.type === "image" && e.source === "illustration");
  return box ? { width: (box.w / 100) * size.width, height: (box.h / 100) * size.height } : size;
}

const STALE_MS = 10 * 60 * 1000;

/** Any member. Claims the post's images (a second request while one runs is refused) and queues the job. */
export async function requestImages(db: Db, queue: { send(name: string, data: object, key: string): Promise<void> }, ctx: OrgContext, postId: string, mode: ImageMode) {
  z.enum(["new", "text"]).parse(mode);
  const [p] = (await forOrg(db, ctx).select(posts, eq(posts.id, postId))) as (typeof posts.$inferSelect)[];
  if (!p) throw new ImageJobError("NOT_FOUND");
  if (p.status === "skipped") throw new ImageJobError("BAD_STATE");
  if (!(await currentDesign(db, ctx, p.brandId))) throw new ImageJobError("NO_DESIGN");
  const claimed = await forOrg(db, ctx).update(
    posts,
    { mediaStatus: "queued", mediaError: null, mediaRequestedBy: ctx.userId, updatedAt: new Date() },
    and(
      eq(posts.id, postId),
      or(inArray(posts.mediaStatus, ["none", "ready", "failed"]), and(inArray(posts.mediaStatus, ["queued", "rendering"]), lt(posts.updatedAt, new Date(Date.now() - STALE_MS))))!,
    )!,
  );
  if (!claimed.length) throw new ImageJobError("BAD_STATE");
  await queue.send(POST_IMAGE_QUEUE, { postId, mode } satisfies PostImageJob, `post:${postId}:image`);
}

export async function listPostMedia(db: Db, ctx: OrgContext, postId: string) {
  return db
    .select({ id: postMedia.id, kind: postMedia.kind, position: postMedia.position, width: postMedia.width, height: postMedia.height, sizeBytes: postMedia.sizeBytes, createdAt: postMedia.createdAt })
    .from(postMedia)
    .where(and(eq(postMedia.orgId, ctx.orgId), eq(postMedia.postId, postId), eq(postMedia.kind, "slide")))
    .orderBy(asc(postMedia.position));
}

/** A presigned URL for one image of the org (inline for previews, attachment for downloads). */
export async function postMediaUrl(db: Db, storage: Storage, ctx: OrgContext, mediaId: string, download: boolean) {
  const [m] = await db
    .select({ key: postMedia.storageKey, type: postMedia.contentType, position: postMedia.position, kind: postMedia.kind, postId: postMedia.postId, slug: brands.slug, on: posts.scheduledOn })
    .from(postMedia)
    .innerJoin(posts, and(eq(posts.id, postMedia.postId), eq(posts.orgId, ctx.orgId)))
    .innerJoin(brands, and(eq(brands.id, posts.brandId), eq(brands.orgId, ctx.orgId)))
    .where(and(eq(postMedia.id, mediaId), eq(postMedia.orgId, ctx.orgId)));
  if (!m) throw new ImageJobError("NOT_FOUND");
  const ext = m.type === "image/png" ? "png" : "jpg";
  const filename = `${m.slug}-${m.on ?? m.postId.slice(0, 8)}-${m.kind === "slide" ? m.position + 1 : `ilustracija-${m.position + 1}`}.${ext}`;
  return storage.presignGet(m.key, { filename, contentType: m.type, inline: !download });
}

const key = (orgId: string, postId: string, ext: string) => `org/${orgId}/posts/${postId}/${crypto.randomUUID()}.${ext}`;

type MediaRow = Omit<typeof postMedia.$inferInsert, "orgId">;

/** Claude's plan for the post's images (one retry with the validation errors). */
async function planVisual(db: Db, deps: ImageDeps, ctx: OrgContext, p: typeof posts.$inferSelect, spec: DesignSpec, designId: string, where: { brandName: string; platform: Platform | null; language: string }): Promise<PostVisual> {
  const schema = postVisualSchema(spec);
  let invalid: { draft: unknown; errors: string } | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const req = postVisualRequest(spec, {
      ...where, format: p.format, brief: p.brief, plan: p.plan as Record<string, unknown>, caption: p.content?.caption ?? null,
    }, invalid);
    const out = await cappedCall(db, deps.llm, { orgId: ctx.orgId, brandId: p.brandId, postId: p.id, now: deps.now }, req);
    const parsed = schema.safeParse(out.input);
    if (parsed.success) {
      return {
        designId,
        slides: parsed.data.slides.map((s) => {
          const t = spec.templates.find((x) => x.id === s.templateId)!;
          const slots = Object.fromEntries(Object.entries(s.slots).filter(([, v]) => typeof v === "string" && v.trim())) as Record<string, string>;
          return { templateId: s.templateId, slots, illustration: needsIllustration(t) ? (s.illustration?.trim() || p.plan.imagePrompt || p.plan.topic || p.brief) : null };
        }),
      };
    }
    invalid = { draft: out.input, errors: issues(parsed.error) };
  }
  throw new ImageJobError("INVALID_OUTPUT");
}

/** One illustration: the brand's style-reference model when it has past posts, else the default image model. */
async function generateIllustration(db: Db, deps: ImageDeps, ctx: OrgContext, p: typeof posts.$inferSelect, prompt: string, shape: { width: number; height: number }, references: string[]) {
  if (!deps.images) throw new ImageError("NO_IMAGE_KEY");
  const pick = async (kind: "image" | "image_style") =>
    (await db.select().from(modelRegistry).where(and(eq(modelRegistry.kind, kind), eq(modelRegistry.isDefault, true), eq(modelRegistry.enabled, true))))[0];
  const model = (references.length ? await pick("image_style") : undefined) ?? (await pick("image"));
  if (!model) throw new ImageError("IMAGE_PROVIDER");
  const gen = generationSize(shape.width, shape.height);
  const price = (mp: number) => model.perImage + BigInt(mp) * model.perMegapixel;
  const ledgerId = await reserve(db, { orgId: ctx.orgId, brandId: p.brandId, postId: p.id, provider: model.provider, model: model.modelKey, estimate: price(billedMegapixels(gen.width, gen.height)), now: deps.now });
  let out;
  try {
    out = await deps.images.generate({ model: model.modelKey, prompt, ...gen, references: model.kind === "image_style" ? references : undefined, negativePrompt: "text, letters, words, watermark, logo" });
  } catch (e) {
    await release(db, ledgerId);
    throw e;
  }
  const billed = billedMegapixels(out.width, out.height);
  await db.update(usageLedger).set({ state: "settled", megapixels: billed, costMicroUsd: price(billed) }).where(eq(usageLedger.id, ledgerId));
  return { ...out, model: model.modelKey };
}

/**
 * Makes the images of one post as `ctx` (the member who asked). Throws ImageError / SpendCapError / LlmError /
 * ImageJobError for expected outcomes; the caller records them on the post.
 */
export async function renderPostImages(db: Db, deps: ImageDeps, ctx: OrgContext, postId: string, mode: ImageMode) {
  const [p] = (await forOrg(db, ctx).select(posts, eq(posts.id, postId))) as (typeof posts.$inferSelect)[];
  if (!p) throw new ImageJobError("NOT_FOUND");
  const design = await currentDesign(db, ctx, p.brandId);
  if (!design?.spec) throw new ImageJobError("NO_DESIGN");
  const spec = design.spec;
  const { brand, channels: chans } = await getBrandDetail(db, ctx, p.brandId);
  const channel = chans.find((c) => c.id === p.channelId) ?? null;
  const size = await slideSize(db, channel?.platform ?? null, channel?.defaultPresetKey ?? null);
  const assets = await brandAssetBytes(db, deps.storage, ctx, p.brandId);

  // Re-plan for new images, or when the words were planned for another design version.
  const replan = mode === "new" || !p.visual || p.visual.designId !== design.id || p.visual.slides.some((s) => !spec.templates.some((t) => t.id === s.templateId));
  const visual = replan ? await planVisual(db, deps, ctx, p, spec, design.id, { brandName: brand.name, platform: channel?.platform ?? null, language: channel?.language ?? brand.languages[0] ?? "sl" }) : p.visual!;

  const old = (await forOrg(db, ctx).select(postMedia, eq(postMedia.postId, postId))) as (typeof postMedia.$inferSelect)[];
  const oldIllustrations = new Map(old.filter((m) => m.kind === "background").map((m) => [m.position, m]));
  let references: string[] | null = null;
  const newRows: MediaRow[] = [];
  const keptIllustrations = new Set<string>();
  const pngs: Uint8Array[] = [];
  for (const [i, slide] of visual.slides.entries()) {
    const t = spec.templates.find((x) => x.id === slide.templateId)!;
    let illustration: Uint8Array | null = null;
    if (needsIllustration(t)) {
      const prev = oldIllustrations.get(i);
      if (!replan && prev) {
        illustration = await deps.storage.get(prev.storageKey);
        keptIllustrations.add(prev.id);
      } else {
        references ??= (await brandExamples(db, deps.storage, ctx, p.brandId, 4)).map((b) => `data:image/jpeg;base64,${Buffer.from(b).toString("base64")}`);
        const prompt = illustrationPrompt(slide.illustration ?? p.brief, spec);
        const out = await generateIllustration(db, deps, ctx, p, prompt, illustrationShape(t, size), references);
        illustration = out.bytes;
        const k = key(ctx.orgId, postId, "jpg");
        await deps.storage.put(k, out.bytes, "image/jpeg");
        newRows.push({ id: crypto.randomUUID(), postId, kind: "background", position: i, storageKey: k, contentType: "image/jpeg", width: out.width, height: out.height, sizeBytes: out.bytes.byteLength, model: out.model, prompt });
      }
    }
    pngs.push(await renderTemplate(spec, t, size, { slots: slide.slots, illustration, logo: assets.logo, brandFont: assets.font }));
  }
  for (const [i, png] of pngs.entries()) {
    const k = key(ctx.orgId, postId, "png");
    await deps.storage.put(k, png, "image/png");
    newRows.push({ id: crypto.randomUUID(), postId, kind: "slide", position: i, storageKey: k, contentType: "image/png", width: size.width, height: size.height, sizeBytes: png.byteLength });
  }

  // Swap in one transaction; the replaced objects are deleted afterwards (best effort — the rows decide access).
  const replaced = old.filter((m) => !keptIllustrations.has(m.id));
  await db.transaction(async (tx) => {
    const t = forOrg(tx as unknown as Db, ctx);
    if (replaced.length) await t.delete(postMedia, inArray(postMedia.id, replaced.map((m) => m.id)));
    for (const r of newRows) await t.insert(postMedia, r);
    await t.update(posts, { visual, mediaStatus: "ready", mediaError: null, updatedAt: new Date() }, eq(posts.id, postId));
  });
  await Promise.all(replaced.map((m) => deps.storage.delete(m.storageKey).catch(() => undefined)));
  return pngs.length;
}

/** Outcome codes shown on the post page. */
export function imageFailureCode(e: unknown): string | null {
  if (e instanceof ImageError) return e.code;
  if (e instanceof SpendCapError) return "SPEND_CAP";
  if (e instanceof ImageJobError) return e.code;
  if (e instanceof LlmError) return e.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "LLM_PROVIDER";
  return null;
}

/**
 * Worker side. Acts as the member who asked (re-verified: a removed member or suspended org fails the job). Expected
 * failures are recorded on the post; anything else puts the post back in the queue state and rethrows (one retry).
 */
export async function runImageJob(db: Db, deps: ImageDeps, job: PostImageJob): Promise<"done" | "skipped" | "failed"> {
  const [p] = await db.select({ id: posts.id, orgId: posts.orgId, by: posts.mediaRequestedBy }).from(posts).where(eq(posts.id, job.postId));
  if (!p) return "skipped";
  const claimed = await db.update(posts).set({ mediaStatus: "rendering", updatedAt: new Date() }).where(and(eq(posts.id, p.id), eq(posts.mediaStatus, "queued"))).returning({ id: posts.id });
  if (!claimed.length) return "skipped";
  const fail = async (code: string) => {
    await db.update(posts).set({ mediaStatus: "failed", mediaError: code, updatedAt: new Date() }).where(eq(posts.id, p.id));
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
    await renderPostImages(db, deps, ctx, p.id, job.mode);
    return "done";
  } catch (e) {
    const code = imageFailureCode(e);
    if (code) return fail(code);
    await db.update(posts).set({ mediaStatus: "queued" }).where(and(eq(posts.id, p.id), eq(posts.mediaStatus, "rendering")));
    throw e;
  }
}

const slotsInput = z.array(z.partialRecord(z.enum(SLOTS), z.string().max(600))).max(20);

/** The owner/editor edits the words on the images (per image, per slot); "Osveži tekst" then re-renders them. */
export async function setSlideTexts(db: Db, ctx: OrgContext, postId: string, slides: z.input<typeof slotsInput>) {
  const edits = slotsInput.parse(slides);
  const [p] = (await forOrg(db, ctx).select(posts, eq(posts.id, postId))) as (typeof posts.$inferSelect)[];
  if (!p) throw new ImageJobError("NOT_FOUND");
  if (!p.visual) throw new ImageJobError("BAD_STATE");
  const visual: PostVisual = {
    ...p.visual,
    slides: p.visual.slides.map((s, i) => {
      const e = edits[i];
      if (!e) return s;
      const slots = { ...s.slots };
      for (const [k, v] of Object.entries(e)) { if (v?.trim()) slots[k] = v.trim(); else delete slots[k]; }
      return { ...s, slots };
    }),
  };
  await forOrg(db, ctx).update(posts, { visual, updatedAt: new Date() }, eq(posts.id, postId));
}
