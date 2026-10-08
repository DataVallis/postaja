// Ad creatives (TASK-021b, spec §5.8/§5.9): per copy variant Claude picks a brand template, the words on the image and
// the illustration subject; fal draws one illustration per variant (the brand's past posts as style reference); Postaja
// renders every chosen placement in its exact size, keeping text and logo out of the platform's UI (safe zone). Word
// edits re-render on the stored illustrations for free. Download: a ZIP with a folder per placement and copy.csv.
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { adCreativeRuns, adMedia, adSets, brands, brandSources, formatPresets, modelRegistry, type AdVisual } from "../db/schema";
import { renderTemplate } from "../design/render";
import { brandAssetBytes, brandExamples, currentDesign, isPartnerLogo, partnerLogoBytes } from "../design/service";
import { issues as zodIssues } from "../design/ai";
import { needsIllustration, SLOTS } from "../design/spec";
import type { Storage } from "../files/storage";
import { zipStream, type ZipSource } from "../files/zip-writer";
import { cappedCall, textModelFor } from "../llm/call";
import { worstCaseMicroUsd } from "../llm/cost";
import { billedMegapixels } from "../images/fal";
import { generateIllustration, illustrationPrompt, imageFailureCode, ImageJobError, type ImageDeps } from "../images/service";
import { resolveOrgContext, TenancyError, type OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { adVisualRequest, adVisualSchema } from "./ai";
import { textsOf } from "./check";
import { AdError, adCopyCsv, adSlug, creativeName, getAdSet } from "./service";
export { creativeName } from "./service";

export const AD_IMAGE_QUEUE = "ad-image";
export type AdImageMode = "new" | "text";
export type AdImageJob = { adSetId: string; mode: AdImageMode };
/** One illustration per variant, made square (~1 MP) and cropped into each placement's illustration box. */
const ILLUSTRATION = { width: 1024, height: 1024 };
const STALE_MS = 10 * 60 * 1000;

type Queue = { send(name: string, data: object, key: string): Promise<void> };
type AdSetRow = typeof adSets.$inferSelect;

/** The words a variant offers the image: a headline, a main text and the CTA button (first network that has them). */
export function copyForImage(v: AdSetRow["copy"][number]) {
  const first = (...xs: (string | string[] | undefined)[]) => xs.map((x) => textsOf(x)[0]).find(Boolean) ?? "";
  return {
    headline: first(v.meta?.headline, v.linkedin?.headline, v.google_display?.headlines, v.google_display?.long_headline),
    text: first(v.meta?.primary_text, v.linkedin?.intro_text, v.google_display?.descriptions),
    cta: first(v.meta?.cta, v.linkedin?.cta),
  };
}

/** Any member. Claims the ad set's images (a second request while one runs is refused) and queues the job. */
/** Any member (TASK-046): the partner logo on the creatives; existing creatives are redrawn with it for free. */
export async function setAdPartnerLogo(db: Db, queue: Queue, ctx: OrgContext, id: string, partnerLogoId: string | null): Promise<"redrawn" | "saved"> {
  const a = await getAdSet(db, ctx, id);
  if (partnerLogoId && !(await isPartnerLogo(db, ctx, a.brandId, partnerLogoId))) throw new AdError("INVALID");
  if (a.visual && a.copy.length && (await currentDesign(db, ctx, a.brandId))) {
    await requestAdImages(db, queue, ctx, id, "text", { partnerLogoId });
    return "redrawn";
  }
  await forOrg(db, ctx).update(adSets, { partnerLogoId, updatedAt: new Date() }, eq(adSets.id, id));
  return "saved";
}

export async function requestAdImages(db: Db, queue: Queue, ctx: OrgContext, id: string, mode: AdImageMode, opts: { partnerLogoId?: string | null } = {}) {
  z.enum(["new", "text"]).parse(mode);
  const a = await getAdSet(db, ctx, id);
  if (!a.copy.length) throw new AdError("BAD_STATE", "NO_COPY");
  if (!(await currentDesign(db, ctx, a.brandId))) throw new AdError("BAD_STATE", "NO_DESIGN");
  if (mode === "text" && !a.visual) throw new AdError("BAD_STATE");
  // TASK-046: the partner logo on the creatives (undefined = keep, null = none); only this brand's partners.
  if (opts.partnerLogoId && !(await isPartnerLogo(db, ctx, a.brandId, opts.partnerLogoId))) throw new AdError("INVALID");
  const claimed = await forOrg(db, ctx).update(
    adSets,
    { mediaStatus: "queued", mediaError: null, mediaRequestedBy: ctx.userId, updatedAt: new Date(), ...(opts.partnerLogoId !== undefined ? { partnerLogoId: opts.partnerLogoId } : {}) },
    and(eq(adSets.id, id), or(inArray(adSets.mediaStatus, ["none", "ready", "failed"]), and(inArray(adSets.mediaStatus, ["queued", "rendering"]), lt(adSets.updatedAt, new Date(Date.now() - STALE_MS))))!)!,
  );
  if (!claimed.length) throw new AdError("BAD_STATE", "BUSY");
  await queue.send(AD_IMAGE_QUEUE, { adSetId: id, mode } satisfies AdImageJob, `ad:${id}:image`);
}

const key = (orgId: string, id: string, ext: string) => `org/${orgId}/ads/${id}/${crypto.randomUUID()}.${ext}`;

/** Makes the ad set's creatives as `ctx`. Throws ImageError / SpendCapError / LlmError / ImageJobError / AdError. */
export async function renderAdImages(db: Db, deps: ImageDeps, ctx: OrgContext, id: string, mode: AdImageMode) {
  const a = await getAdSet(db, ctx, id);
  if (!a.copy.length) throw new AdError("BAD_STATE", "NO_COPY");
  const design = await currentDesign(db, ctx, a.brandId);
  if (!design?.spec) throw new ImageJobError("NO_DESIGN");
  const spec = design.spec;
  const [brand] = (await forOrg(db, ctx).select(brands, eq(brands.id, a.brandId))) as (typeof brands.$inferSelect)[];
  const presets = (await db.select().from(formatPresets).where(inArray(formatPresets.key, a.placements))).sort((x, y) => a.placements.indexOf(x.key) - a.placements.indexOf(y.key));
  if (!presets.length) throw new AdError("NO_PLACEMENT");

  const replan = mode === "new" || !a.visual || a.visual.designId !== design.id || a.visual.variants.length !== a.copy.length
    || a.visual.variants.some((v) => !spec.templates.some((t) => t.id === v.templateId));
  let visual: AdVisual;
  if (replan) {
    const schema = adVisualSchema(spec, a.copy.length);
    let invalid: { draft: unknown; errors: string } | undefined;
    let planned: AdVisual | null = null;
    for (let attempt = 0; attempt < 2 && !planned; attempt++) {
      const out = await cappedCall(db, deps.llm, { orgId: ctx.orgId, brandId: a.brandId, postId: null, now: deps.now }, adVisualRequest(spec, {
        brandName: brand.name, language: a.language, objective: a.objective, offer: a.offer, copies: a.copy.map(copyForImage),
      }, invalid));
      const parsed = schema.safeParse(out.input);
      if (parsed.success) {
        planned = {
          designId: design.id,
          variants: parsed.data.visuals.map((v, i) => {
            const t = spec.templates.find((x) => x.id === v.templateId)!;
            const slots = Object.fromEntries(Object.entries(v.slots).filter(([, x]) => typeof x === "string" && x.trim())) as Record<string, string>;
            return { templateId: v.templateId, slots, illustration: needsIllustration(t) ? (v.illustration?.trim() || copyForImage(a.copy[i]).headline || a.offer || brand.name) : null };
          }),
        };
      } else invalid = { draft: out.input, errors: zodIssues(parsed.error) };
    }
    if (!planned) throw new ImageJobError("INVALID_OUTPUT");
    visual = planned;
  } else visual = a.visual!;

  const assets = await brandAssetBytes(db, deps.storage, ctx, a.brandId);
  const partner = await partnerLogoBytes(db, deps.storage, ctx, a.brandId, a.partnerLogoId);
  // The current creatives (earlier versions are archived and stay — TASK-034).
  const old = (await forOrg(db, ctx).select(adMedia, and(eq(adMedia.adSetId, id), isNull(adMedia.archivedAt))!)) as (typeof adMedia.$inferSelect)[];
  const oldIllustrations = new Map(old.filter((m) => m.kind === "illustration").map((m) => [m.variant, m]));
  const kept = new Set<string>();
  const rows: Omit<typeof adMedia.$inferInsert, "orgId">[] = [];
  let references: string[] | null = null;
  for (const [i, v] of visual.variants.entries()) {
    const t = spec.templates.find((x) => x.id === v.templateId)!;
    let illustration: Uint8Array | null = null;
    if (needsIllustration(t)) {
      const prev = oldIllustrations.get(i);
      if (!replan && prev) {
        illustration = await deps.storage.get(prev.storageKey);
        kept.add(prev.id);
      } else {
        references ??= (await brandExamples(db, deps.storage, ctx, a.brandId, 4)).map((b) => `data:image/jpeg;base64,${Buffer.from(b).toString("base64")}`);
        const prompt = illustrationPrompt(v.illustration ?? a.offer, spec);
        const out = await generateIllustration(db, deps, ctx, { brandId: a.brandId, postId: null }, prompt, ILLUSTRATION, references);
        illustration = out.bytes;
        const k = key(ctx.orgId, id, "jpg");
        await deps.storage.put(k, out.bytes, "image/jpeg");
        rows.push({ id: crypto.randomUUID(), adSetId: id, kind: "illustration", variant: i, placement: "", storageKey: k, contentType: "image/jpeg", width: out.width, height: out.height, sizeBytes: out.bytes.byteLength, model: out.model, prompt });
      }
    }
    for (const p of presets) {
      const png = await renderTemplate(spec, t, { width: p.width, height: p.height }, { slots: v.slots, illustration, logo: assets.logo, ...partner, brandFont: assets.font, safe: p.safeZone });
      const k = key(ctx.orgId, id, "png");
      await deps.storage.put(k, png, "image/png");
      rows.push({ id: crypto.randomUUID(), adSetId: id, kind: "creative", variant: i, placement: p.key, storageKey: k, contentType: "image/png", width: p.width, height: p.height, sizeBytes: png.byteLength });
    }
  }
  // A new version (TASK-034, ADR-062): replaced creatives are archived, never deleted.
  const replaced = old.filter((m) => !kept.has(m.id));
  const runId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    const s = forOrg(tx as unknown as Db, ctx);
    if (replaced.length) await s.update(adMedia, { archivedAt: new Date() }, inArray(adMedia.id, replaced.map((m) => m.id)));
    await s.insert(adCreativeRuns, { id: runId, adSetId: id, visual, kept: [...kept], createdBy: ctx.userId });
    for (const r of rows) await s.insert(adMedia, { ...r, runId });
    await s.update(adSets, { visual, mediaStatus: "ready", mediaError: null, updatedAt: new Date() }, eq(adSets.id, id));
  });
  return rows.filter((r) => r.kind === "creative").length;
}

/** Worker side: acts as the member who asked (re-verified); expected failures are recorded on the ad set. */
export async function runAdImageJob(db: Db, deps: ImageDeps, job: AdImageJob): Promise<"done" | "skipped" | "failed"> {
  const [a] = await db.select({ id: adSets.id, orgId: adSets.orgId, by: adSets.mediaRequestedBy }).from(adSets).where(eq(adSets.id, job.adSetId));
  if (!a) return "skipped";
  const claimed = await db.update(adSets).set({ mediaStatus: "rendering", updatedAt: new Date() }).where(and(eq(adSets.id, a.id), eq(adSets.mediaStatus, "queued"))).returning({ id: adSets.id });
  if (!claimed.length) return "skipped";
  const fail = async (code: string) => {
    await db.update(adSets).set({ mediaStatus: "failed", mediaError: code.slice(0, 300), updatedAt: new Date() }).where(eq(adSets.id, a.id));
    return "failed" as const;
  };
  if (!a.by) return fail("NO_ACCESS");
  let ctx: OrgContext;
  try {
    ctx = await resolveOrgContext(db, { userId: a.by, activeOrganizationId: a.orgId });
  } catch (e) {
    if (e instanceof TenancyError) return fail("NO_ACCESS");
    throw e;
  }
  try {
    await renderAdImages(db, deps, ctx, a.id, job.mode);
    return "done";
  } catch (e) {
    const code = e instanceof AdError ? (e.detail ?? e.code) : imageFailureCode(e);
    if (code) return fail(code);
    await db.update(adSets).set({ mediaStatus: "queued" }).where(and(eq(adSets.id, a.id), eq(adSets.mediaStatus, "rendering")));
    throw e;
  }
}

const slotsInput = z.array(z.partialRecord(z.enum(SLOTS), z.string().max(300))).max(5);

/** Corrected words on the images (per variant, per slot); the caller then queues a "text" re-render. */
export async function setAdSlides(db: Db, ctx: OrgContext, id: string, edits: z.input<typeof slotsInput>) {
  const e = slotsInput.parse(edits);
  const a = await getAdSet(db, ctx, id);
  if (!a.visual) throw new AdError("BAD_STATE");
  const visual: AdVisual = {
    ...a.visual,
    variants: a.visual.variants.map((v, i) => {
      if (!e[i]) return v;
      const slots = { ...v.slots };
      for (const [k, val] of Object.entries(e[i])) { if (val?.trim()) slots[k] = val.trim(); else delete slots[k]; }
      return { ...v, slots };
    }),
  };
  await forOrg(db, ctx).update(adSets, { visual, updatedAt: new Date() }, eq(adSets.id, id));
}

export async function listAdMedia(db: Db, ctx: OrgContext, id: string) {
  return db.select({ id: adMedia.id, variant: adMedia.variant, placement: adMedia.placement, width: adMedia.width, height: adMedia.height })
    .from(adMedia)
    .where(and(eq(adMedia.orgId, ctx.orgId), eq(adMedia.adSetId, id), eq(adMedia.kind, "creative"), isNull(adMedia.archivedAt)))
    .orderBy(asc(adMedia.placement), asc(adMedia.variant));
}

/** A presigned URL for one creative of the org's ad set (inline for previews, attachment for downloads). */
export async function adMediaUrl(db: Db, storage: Storage, ctx: OrgContext, mediaId: string, download: boolean) {
  const [m] = await db
    .select({ key: adMedia.storageKey, type: adMedia.contentType, placement: adMedia.placement, variant: adMedia.variant, adSetId: adSets.id, name: adSets.name, slug: brands.slug })
    .from(adMedia)
    .innerJoin(adSets, and(eq(adSets.id, adMedia.adSetId), eq(adSets.orgId, ctx.orgId)))
    .innerJoin(brands, and(eq(brands.id, adSets.brandId), eq(brands.orgId, ctx.orgId)))
    .where(and(eq(adMedia.id, mediaId), eq(adMedia.orgId, ctx.orgId), eq(adMedia.kind, "creative")));
  if (!m) throw new AdError("NOT_FOUND");
  return storage.presignGet(m.key, { filename: creativeName(m.slug, { id: m.adSetId, name: m.name }, m.placement, m.variant), contentType: m.type, inline: !download });
}

/** The ad set as one ZIP: copy.csv (with the image file per row) and a folder per placement with its creatives. */
export async function adZip(db: Db, storage: Storage, ctx: OrgContext, id: string): Promise<{ filename: string; stream: ReadableStream<Uint8Array> }> {
  const a = await getAdSet(db, ctx, id);
  const [brand] = (await forOrg(db, ctx).select(brands, eq(brands.id, a.brandId))) as (typeof brands.$inferSelect)[];
  const media = (await forOrg(db, ctx).select(adMedia, and(eq(adMedia.adSetId, id), eq(adMedia.kind, "creative"), isNull(adMedia.archivedAt))!)) as (typeof adMedia.$inferSelect)[];
  if (!media.length) throw new AdError("BAD_STATE", "NO_IMAGES");
  const { csv } = await adCopyCsv(db, ctx, id);
  const entries: ZipSource[] = [{ name: "copy.csv", bytes: async () => new TextEncoder().encode(csv) }];
  for (const m of media.sort((x, y) => a.placements.indexOf(x.placement) - a.placements.indexOf(y.placement) || x.variant - y.variant)) {
    entries.push({ name: `${m.placement}/${creativeName(brand.slug, a, m.placement, m.variant)}`, bytes: () => storage.get(m.storageKey) });
  }
  return { filename: `${brand.slug}_${adSlug(a)}.zip`, stream: zipStream(entries) };
}

/**
 * What "Ustvari slike" costs at most (shown on the button, ADR-047 style): one illustration per variant when the
 * brand's templates use illustrations, at the image model's price, plus the planning call with one retry.
 */
export async function adImageEstimate(db: Db, ctx: OrgContext, a: Pick<AdSetRow, "brandId" | "copy">) {
  const design = await currentDesign(db, ctx, a.brandId);
  if (!design?.spec) return null;
  const illustrated = design.spec.templates.some(needsIllustration);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(brandSources)
    .where(and(eq(brandSources.orgId, ctx.orgId), eq(brandSources.brandId, a.brandId), eq(brandSources.kind, "image")));
  const pick = async (kind: "image" | "image_style") => (await db.select().from(modelRegistry).where(and(eq(modelRegistry.kind, kind), eq(modelRegistry.isDefault, true), eq(modelRegistry.enabled, true))))[0];
  const m = (n > 0 ? await pick("image_style") : undefined) ?? (await pick("image"));
  const text = await textModelFor(db, a.brandId).catch(() => null);
  const illustrations = illustrated ? a.copy.length : 0;
  const each = m ? m.perImage + BigInt(billedMegapixels(ILLUSTRATION.width, ILLUSTRATION.height)) * m.perMegapixel : 0n;
  const plan = text ? 2n * worstCaseMicroUsd(5_000 + JSON.stringify(design.spec.templates).length, 3_000, text) : 0n;
  return { illustrations, max: BigInt(illustrations) * each + plan };
}

// ---- Earlier versions of an ad set's creatives (TASK-034, ADR-062) ---------------------------------------------------

/** Earlier creative versions, newest first, with their archived creatives. Any member. */
export async function listCreativeVersions(db: Db, ctx: OrgContext, id: string) {
  const rows = await db.select({ id: adMedia.id, runId: adMedia.runId, variant: adMedia.variant, placement: adMedia.placement, width: adMedia.width, height: adMedia.height })
    .from(adMedia)
    .where(and(eq(adMedia.orgId, ctx.orgId), eq(adMedia.adSetId, id), eq(adMedia.kind, "creative"), isNotNull(adMedia.archivedAt)))
    .orderBy(asc(adMedia.variant), asc(adMedia.placement));
  const ids = [...new Set(rows.map((r) => r.runId).filter((x): x is string => !!x))];
  if (!ids.length) return [];
  const runs = await db.select().from(adCreativeRuns).where(and(eq(adCreativeRuns.orgId, ctx.orgId), inArray(adCreativeRuns.id, ids))).orderBy(desc(adCreativeRuns.createdAt));
  return runs.map((r) => ({ id: r.id, createdAt: r.createdAt, creatives: rows.filter((x) => x.runId === r.id) }));
}

/** The illustrations a version drew on: its own and the ones it reused (`kept`). */
async function versionIllustrations(db: Db, ctx: OrgContext, id: string) {
  const runs = await db.select({ id: adCreativeRuns.id, kept: adCreativeRuns.kept }).from(adCreativeRuns)
    .where(and(eq(adCreativeRuns.orgId, ctx.orgId), eq(adCreativeRuns.adSetId, id)));
  const own = await db.select({ id: adMedia.id, runId: adMedia.runId }).from(adMedia)
    .where(and(eq(adMedia.orgId, ctx.orgId), eq(adMedia.adSetId, id), eq(adMedia.kind, "illustration")));
  return new Map(runs.map((r) => [r.id, new Set([...own.filter((m) => m.runId === r.id).map((m) => m.id), ...r.kept])]));
}

/** Any member: an earlier version of the creatives becomes current again (with its words); nothing is deleted. */
export async function restoreCreativeVersion(db: Db, ctx: OrgContext, id: string, runId: string) {
  const a = await getAdSet(db, ctx, id);
  if (a.mediaStatus === "queued" || a.mediaStatus === "rendering") throw new AdError("BAD_STATE");
  const [run] = (await forOrg(db, ctx).select(adCreativeRuns, and(eq(adCreativeRuns.id, runId), eq(adCreativeRuns.adSetId, id))!)) as (typeof adCreativeRuns.$inferSelect)[];
  if (!run) throw new AdError("NOT_FOUND");
  const illustrations = [...((await versionIllustrations(db, ctx, id)).get(runId) ?? [])];
  await db.transaction(async (tx) => {
    const s = forOrg(tx as unknown as Db, ctx);
    const now = new Date();
    await s.update(adMedia, { archivedAt: now }, and(eq(adMedia.adSetId, id), isNull(adMedia.archivedAt))!);
    await s.update(adMedia, { archivedAt: null }, and(eq(adMedia.adSetId, id), eq(adMedia.runId, runId), eq(adMedia.kind, "creative"))!);
    if (illustrations.length) await s.update(adMedia, { archivedAt: null }, and(eq(adMedia.adSetId, id), inArray(adMedia.id, illustrations))!);
    await s.update(adSets, { visual: run.visual, mediaStatus: "ready", mediaError: null, updatedAt: now }, eq(adSets.id, id));
  });
}

/** Any member deletes an earlier creatives version for good; an illustration another version drew on stays. */
export async function deleteCreativeVersion(db: Db, storage: Storage, ctx: OrgContext, id: string, runId: string) {
  const byRun = await versionIllustrations(db, ctx, id);
  const mine = byRun.get(runId);
  const archived = and(eq(adMedia.adSetId, id), isNotNull(adMedia.archivedAt));
  const creatives = mine ? ((await forOrg(db, ctx).select(adMedia, and(archived, eq(adMedia.runId, runId), eq(adMedia.kind, "creative"))!)) as (typeof adMedia.$inferSelect)[]) : [];
  if (!creatives.length) throw new AdError("NOT_FOUND"); // unknown, or the current version
  const elsewhere = new Set([...byRun].filter(([r]) => r !== runId).flatMap(([, ids]) => [...ids]));
  const illustrations = [...mine!].filter((x) => !elsewhere.has(x));
  const gone = (await forOrg(db, ctx).delete(adMedia, and(archived, or(
    and(eq(adMedia.runId, runId), eq(adMedia.kind, "creative")),
    illustrations.length ? inArray(adMedia.id, illustrations) : sql`false`,
  ))!)) as (typeof adMedia.$inferSelect)[];
  await forOrg(db, ctx).delete(adCreativeRuns, eq(adCreativeRuns.id, runId));
  await Promise.all(gone.map((m) => storage.delete(m.storageKey).catch(() => undefined)));
}
