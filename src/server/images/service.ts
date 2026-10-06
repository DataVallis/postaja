// Post images (TASK-015, ADR-043): a member asks for images → the post is claimed (media_status queued) and one job is
// queued → a worker generates the background (fal, cost-capped) and renders the brand template with the plan's
// texts → PNGs in S3 + post_media rows. "Osveži tekst" re-renders on the stored background, at no image cost.
import { and, asc, eq, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { brandAssets, brands, formatPresets, modelRegistry, posts, postMedia, usageLedger, type Platform, type PostPlan } from "../db/schema";
import { templateSchema } from "../brands/schemas";
import { getBrandDetail } from "../brands/service";
import type { Storage } from "../files/storage";
import { reserve, release, SpendCapError } from "../llm/spend";
import { resolveOrgContext, TenancyError, type OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { billedMegapixels, generationSize, ImageError, type ImageClient } from "./fal";
import { renderSlides, type SlideText } from "./render";
import { DEFAULT_COLORS, DEFAULT_TEMPLATE, type BrandTemplate, type Colors } from "./template";

export const POST_IMAGE_QUEUE = "post-image";
export type ImageMode = "new" | "text";
export type PostImageJob = { postId: string; mode: ImageMode };
export const MAX_SLIDES = 20;

export class ImageJobError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "BAD_STATE" | "INVALID") {
    super(code);
  }
}

export type ImageDeps = { images: ImageClient | null; storage: Storage; now?: Date };

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

export function brandTemplate(visual: { template?: unknown } | null | undefined): BrandTemplate {
  const r = templateSchema.safeParse(visual?.template ?? {});
  return r.success ? r.data : DEFAULT_TEMPLATE;
}

export function brandColors(colors: { primary?: string; background?: string; text?: string; accent?: string } | undefined): Colors {
  return {
    background: colors?.background ?? DEFAULT_COLORS.background,
    text: colors?.text ?? DEFAULT_COLORS.text,
    accent: colors?.accent ?? colors?.primary ?? DEFAULT_COLORS.accent,
  };
}

/**
 * Texts on the images, from the plan's own words: carousel slides one per image; otherwise the overlay text, the topic,
 * or the brief. The label (category chip) goes on the first image only.
 */
export function slideTexts(p: { format: string; brief: string; plan: PostPlan }, tpl: BrandTemplate): SlideText[] {
  const label = tpl.label === "category" ? p.plan.category?.trim() || null : null;
  if (tpl.layout === "photo") return [{ label: null, headline: null }];
  const slides = (p.plan.slides ?? []).map((s) => s.trim()).filter(Boolean);
  if (p.format === "carousel" && slides.length) return slides.slice(0, MAX_SLIDES).map((headline, i) => ({ label: i === 0 ? label : null, headline }));
  const headline = (p.plan.overlayText ?? p.plan.topic ?? p.brief).trim().slice(0, 300);
  return [{ label, headline: headline || null }];
}

/** What the image model is asked for: the plan's picture, the brand's look, and never any letters (ADR-009). */
export function backgroundPrompt(p: { brief: string; plan: PostPlan }, visual: { imageStyle?: string; negativePrompt?: string }): string {
  const subject = (p.plan.imagePrompt ?? p.plan.topic ?? p.brief).trim().slice(0, 1200);
  const parts = [
    subject,
    visual.imageStyle?.trim() ? `Style: ${visual.imageStyle.trim().slice(0, 500)}` : "",
    "No text, no letters, no numbers, no words, no logos, no watermarks. Leave calm, uncluttered space for a headline.",
    visual.negativePrompt?.trim() ? `Avoid: ${visual.negativePrompt.trim().slice(0, 300)}` : "",
  ];
  return parts.filter(Boolean).join("\n");
}

/** The template's logo (null = the brand's first logo, "none" = no logo) and font (null = built-in), as bytes. */
export async function brandAssetsFor(db: Db, storage: Storage, ctx: OrgContext, brandId: string, tpl: BrandTemplate) {
  const assets = (await forOrg(db, ctx).select(brandAssets, eq(brandAssets.brandId, brandId))) as (typeof brandAssets.$inferSelect)[];
  assets.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const logoRow = tpl.logoId === "none" ? undefined : tpl.logoId ? assets.find((a) => a.id === tpl.logoId && a.kind === "logo") : assets.find((a) => a.kind === "logo");
  const fontRow = tpl.fontId ? assets.find((a) => a.id === tpl.fontId && a.kind === "font") : undefined;
  const [logo, brandFont] = await Promise.all([logoRow ? storage.get(logoRow.storageKey) : null, fontRow ? storage.get(fontRow.storageKey) : null]);
  return { logo, brandFont };
}

const STALE_MS = 10 * 60 * 1000;

/** Any member. Claims the post's images (a second request while one runs is refused) and queues the job. */
export async function requestImages(db: Db, queue: { send(name: string, data: object, key: string): Promise<void> }, ctx: OrgContext, postId: string, mode: ImageMode) {
  z.enum(["new", "text"]).parse(mode);
  const [p] = (await forOrg(db, ctx).select(posts, eq(posts.id, postId))) as (typeof posts.$inferSelect)[];
  if (!p) throw new ImageJobError("NOT_FOUND");
  if (p.status === "skipped") throw new ImageJobError("BAD_STATE");
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
  const filename = `${m.slug}-${m.on ?? m.postId.slice(0, 8)}-${m.kind === "slide" ? m.position + 1 : "ozadje"}.${ext}`;
  return storage.presignGet(m.key, { filename, contentType: m.type, inline: !download });
}

const key = (orgId: string, postId: string, ext: string) => `org/${orgId}/posts/${postId}/${crypto.randomUUID()}.${ext}`;

type MediaRow = Omit<typeof postMedia.$inferInsert, "orgId">;

/**
 * Makes the images of one post as `ctx` (the member who asked). Throws ImageError / SpendCapError for expected
 * provider/cost outcomes; the caller records them on the post.
 */
export async function renderPostImages(db: Db, deps: ImageDeps, ctx: OrgContext, postId: string, mode: ImageMode) {
  const [p] = (await forOrg(db, ctx).select(posts, eq(posts.id, postId))) as (typeof posts.$inferSelect)[];
  if (!p) throw new ImageJobError("NOT_FOUND");
  const { profile, channels: chans } = await getBrandDetail(db, ctx, p.brandId);
  const visual = profile?.visual ?? { colors: {}, imageStyle: "", negativePrompt: "" };
  const tpl = brandTemplate(visual);
  const colors = brandColors(visual.colors);
  const channel = chans.find((c) => c.id === p.channelId) ?? null;
  const size = await slideSize(db, channel?.platform ?? null, channel?.defaultPresetKey ?? null);

  const { logo, brandFont } = await brandAssetsFor(db, deps.storage, ctx, p.brandId, tpl);

  const old = (await forOrg(db, ctx).select(postMedia, eq(postMedia.postId, postId))) as (typeof postMedia.$inferSelect)[];
  const oldBackground = old.find((m) => m.kind === "background");
  const newRows: MediaRow[] = [];
  let background: Uint8Array | null = null;
  if (tpl.background === "ai") {
    if (mode === "text" && oldBackground) {
      background = await deps.storage.get(oldBackground.storageKey);
    } else {
      const bg = await generateBackground(db, deps, ctx, p, visual, size);
      background = bg.bytes;
      const k = key(ctx.orgId, postId, "jpg");
      await deps.storage.put(k, bg.bytes, "image/jpeg");
      newRows.push({ id: crypto.randomUUID(), postId, kind: "background", position: 0, storageKey: k, contentType: "image/jpeg", width: bg.width, height: bg.height, sizeBytes: bg.bytes.byteLength, model: bg.model, prompt: bg.prompt });
    }
  }

  const pngs = await renderSlides(tpl, colors, size, slideTexts(p, tpl), { logo, brandFont, background });
  for (let i = 0; i < pngs.length; i++) {
    const k = key(ctx.orgId, postId, "png");
    await deps.storage.put(k, pngs[i], "image/png");
    newRows.push({ id: crypto.randomUUID(), postId, kind: "slide", position: i, storageKey: k, contentType: "image/png", width: size.width, height: size.height, sizeBytes: pngs[i].byteLength });
  }

  // Swap in one transaction; the replaced objects are deleted afterwards (best effort — the rows decide access).
  const replaceBackground = newRows.some((r) => r.kind === "background") || tpl.background === "plain";
  const replaced = old.filter((m) => m.kind === "slide" || replaceBackground);
  await db.transaction(async (tx) => {
    const t = forOrg(tx as unknown as Db, ctx);
    if (replaced.length) await t.delete(postMedia, inArray(postMedia.id, replaced.map((m) => m.id)));
    for (const r of newRows) await t.insert(postMedia, r);
    await t.update(posts, { mediaStatus: "ready", mediaError: null, updatedAt: new Date() }, eq(posts.id, postId));
  });
  await Promise.all(replaced.map((m) => deps.storage.delete(m.storageKey).catch(() => undefined)));
  return pngs.length;
}

async function generateBackground(
  db: Db, deps: ImageDeps, ctx: OrgContext, p: typeof posts.$inferSelect,
  visual: { imageStyle?: string; negativePrompt?: string }, size: { width: number; height: number },
) {
  if (!deps.images) throw new ImageError("NO_IMAGE_KEY");
  const [model] = await db.select().from(modelRegistry).where(and(eq(modelRegistry.kind, "image"), eq(modelRegistry.isDefault, true), eq(modelRegistry.enabled, true)));
  if (!model) throw new ImageError("IMAGE_PROVIDER");
  const gen = generationSize(size.width, size.height);
  const mp = billedMegapixels(gen.width, gen.height);
  const cost = BigInt(mp) * model.perMegapixel;
  const prompt = backgroundPrompt(p, visual);
  const ledgerId = await reserve(db, { orgId: ctx.orgId, brandId: p.brandId, postId: p.id, provider: model.provider, model: model.modelKey, estimate: cost, now: deps.now });
  let out;
  try {
    out = await deps.images.generate({ model: model.modelKey, prompt, ...gen });
  } catch (e) {
    await release(db, ledgerId);
    throw e;
  }
  const billed = billedMegapixels(out.width, out.height);
  await db.update(usageLedger).set({ state: "settled", megapixels: billed, costMicroUsd: BigInt(billed) * model.perMegapixel }).where(eq(usageLedger.id, ledgerId));
  return { ...out, model: model.modelKey, prompt };
}

/** Outcome codes shown on the post page. */
function failureCode(e: unknown): string | null {
  if (e instanceof ImageError) return e.code;
  if (e instanceof SpendCapError) return "SPEND_CAP";
  if (e instanceof ImageJobError) return e.code;
  return null;
}

/**
 * Worker side. Acts as the member who asked (re-verified: a removed member or suspended org fails the job). Expected
 * failures are recorded on the post; anything else puts the post back in the queue state and rethrows (one retry).
 */
export async function runImageJob(db: Db, deps: ImageDeps, job: PostImageJob): Promise<"done" | "skipped" | "failed"> {
  const [p] = await db.select({ id: posts.id, orgId: posts.orgId, by: posts.mediaRequestedBy, status: posts.mediaStatus }).from(posts).where(eq(posts.id, job.postId));
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
    const code = failureCode(e);
    if (code) return fail(code);
    await db.update(posts).set({ mediaStatus: "queued" }).where(and(eq(posts.id, p.id), eq(posts.mediaStatus, "rendering")));
    throw e;
  }
}

/** Saves the text on the images by hand (one block per slide, blank line between) — any member (TASK-015). */
export async function setImageText(db: Db, ctx: OrgContext, postId: string, text: string) {
  const body = z.string().max(5000).parse(text).replace(/\r\n/g, "\n").trim();
  const [p] = (await forOrg(db, ctx).select(posts, eq(posts.id, postId))) as (typeof posts.$inferSelect)[];
  if (!p) throw new ImageJobError("NOT_FOUND");
  const blocks = body.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length > MAX_SLIDES) throw new ImageJobError("INVALID");
  const plan: PostPlan = { ...p.plan };
  if (p.format === "carousel") {
    if (blocks.length) plan.slides = blocks; else delete plan.slides;
  } else if (body) plan.overlayText = body; else delete plan.overlayText;
  await forOrg(db, ctx).update(posts, { plan, updatedAt: new Date() }, eq(posts.id, postId));
}

/** The text currently used on the images, for the edit field. */
export function imageText(p: { format: string; brief: string; plan: PostPlan }): string {
  if (p.format === "carousel" && p.plan.slides?.length) return p.plan.slides.join("\n\n");
  return p.plan.overlayText ?? p.plan.topic ?? "";
}

