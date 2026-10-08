// Brand designs (TASK-017, ADR-044): the owner asks → a "generating" version is queued → the worker gives Claude the
// CGP, description, colours, logo and past posts (or the current design, its rendered previews and the owner's words)
// → a validated spec becomes the brand's current design. Old versions stay and can be used again.
import { and, desc, eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import type { Db } from "../db/client";
import { brandAssets, brandDesigns, brandSources, brands } from "../db/schema";
import { getBrandDetail } from "../brands/service";
import { MAX_INPUT_PIXELS } from "../files/images";
import type { Storage } from "../files/storage";
import { cappedCall } from "../llm/call";
import { SpendCapError } from "../llm/spend";
import { LlmError, type ImageBlock, type LlmClient } from "../llm/types";
import { resolveOrgContext, TenancyError, type OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { createDesignRequest, issues, reviseDesignRequest, type DesignInputs } from "./ai";
import { renderTemplate } from "./render";
import { designSpecSchema, type DesignSpec } from "./spec";

export const DESIGN_QUEUE = "brand-design";
export type DesignJob = { designId: string };
export const EXAMPLES_MAX = 6;
const STALE_MS = 15 * 60 * 1000;

export class DesignError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "NOT_FOUND" | "ARCHIVED" | "BUSY" | "NO_DESIGN" | "INVALID") {
    super(code);
  }
}

export const SHAPES = { portrait: { width: 1080, height: 1350 }, square: { width: 1080, height: 1080 }, landscape: { width: 1600, height: 900 } } as const;
export type Shape = keyof typeof SHAPES;

const requestInput = z.object({ brief: z.string().max(4000).optional(), instruction: z.string().trim().min(3).max(2000).optional() });

/** Owner only. A new design (from the description) or a revision of the current one (instruction). */
export async function requestDesign(db: Db, queue: { send(name: string, data: object, key: string): Promise<void> }, ctx: OrgContext, brandId: string, input: z.input<typeof requestInput>) {
  if (ctx.role !== "owner") throw new DesignError("FORBIDDEN");
  const r = requestInput.parse(input);
  const { brand } = await getBrandDetail(db, ctx, brandId).catch(() => { throw new DesignError("NOT_FOUND"); });
  if (brand.archivedAt) throw new DesignError("ARCHIVED");
  const current = await currentDesign(db, ctx, brandId);
  if (r.instruction && !current) throw new DesignError("NO_DESIGN");
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    // One at a time per brand; a version stuck for 15 minutes no longer blocks.
    await tx.execute(sql`select 1 from brands where id = ${brandId} for update`);
    const [busy] = await tx.select({ id: brandDesigns.id }).from(brandDesigns)
      .where(and(eq(brandDesigns.brandId, brandId), eq(brandDesigns.status, "generating"), sql`${brandDesigns.updatedAt} > now() - make_interval(secs => ${STALE_MS / 1000})`));
    if (busy) throw new DesignError("BUSY");
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${brandDesigns.version}), 0)::int` }).from(brandDesigns).where(eq(brandDesigns.brandId, brandId));
    await forOrg(tx as unknown as Db, ctx).insert(brandDesigns, {
      id, brandId, version: max + 1, status: "generating",
      brief: r.brief ?? current?.brief ?? "", instruction: r.instruction ?? null, basedOn: r.instruction ? current!.id : null, createdBy: ctx.userId,
    });
  });
  await queue.send(DESIGN_QUEUE, { designId: id } satisfies DesignJob, `design:${brandId}`);
  return id;
}

export async function listDesigns(db: Db, ctx: OrgContext, brandId: string) {
  return db.select().from(brandDesigns).where(and(eq(brandDesigns.orgId, ctx.orgId), eq(brandDesigns.brandId, brandId))).orderBy(desc(brandDesigns.version));
}

/** The brand's current design (a ready version), or null. */
export async function currentDesign(db: Db, ctx: OrgContext, brandId: string) {
  const [b] = await db.select({ id: brands.currentDesignId }).from(brands).where(and(eq(brands.id, brandId), eq(brands.orgId, ctx.orgId)));
  if (!b?.id) return null;
  const [d] = await db.select().from(brandDesigns).where(and(eq(brandDesigns.id, b.id), eq(brandDesigns.orgId, ctx.orgId), eq(brandDesigns.status, "ready")));
  return d ?? null;
}

export async function getDesign(db: Db, ctx: OrgContext, designId: string) {
  const [d] = await db.select().from(brandDesigns).where(and(eq(brandDesigns.id, designId), eq(brandDesigns.orgId, ctx.orgId)));
  if (!d) throw new DesignError("NOT_FOUND");
  return d;
}

/** Owner goes back to (or forward to) another ready version. */
export async function activateDesign(db: Db, ctx: OrgContext, designId: string) {
  if (ctx.role !== "owner") throw new DesignError("FORBIDDEN");
  const d = await getDesign(db, ctx, designId);
  if (d.status !== "ready") throw new DesignError("INVALID");
  await db.update(brands).set({ currentDesignId: d.id, updatedAt: new Date() }).where(and(eq(brands.id, d.brandId), eq(brands.orgId, ctx.orgId)));
}

/** The brand's logo and font bytes (first uploaded of each), for rendering and for Claude. */
export async function brandAssetBytes(db: Db, storage: Storage, ctx: OrgContext, brandId: string) {
  const rows = (await forOrg(db, ctx).select(brandAssets, eq(brandAssets.brandId, brandId))) as (typeof brandAssets.$inferSelect)[];
  rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const logoRow = rows.find((a) => a.kind === "logo");
  const fontRow = rows.find((a) => a.kind === "font");
  const [logo, font] = await Promise.all([logoRow ? storage.get(logoRow.storageKey) : null, fontRow ? storage.get(fontRow.storageKey) : null]);
  return { logo, font, fontFamily: fontRow ? (fontRow.meta.family ?? fontRow.filename) : null };
}

/** The brand's partner logos (TASK-046) by name, to choose one per post or ad. Any member. */
export async function listPartnerLogos(db: Db, ctx: OrgContext, brandId: string): Promise<{ id: string; name: string }[]> {
  const rows = (await forOrg(db, ctx).select(brandAssets, and(eq(brandAssets.brandId, brandId), eq(brandAssets.kind, "partner"))!)) as (typeof brandAssets.$inferSelect)[];
  return rows.map((r) => ({ id: r.id, name: r.meta.name ?? r.filename })).sort((a, b) => a.name.localeCompare(b.name, "sl"));
}

/** Whether `id` is one of this brand's partner logos (another brand's or org's never is). */
export async function isPartnerLogo(db: Db, ctx: OrgContext, brandId: string, id: string): Promise<boolean> {
  const [row] = await forOrg(db, ctx).select(brandAssets, and(eq(brandAssets.id, id), eq(brandAssets.brandId, brandId), eq(brandAssets.kind, "partner"))!);
  return !!row;
}

/** The chosen partner logo as render input (bytes and name), or empty (none chosen, or deleted since). */
export async function partnerLogoBytes(db: Db, storage: Storage, ctx: OrgContext, brandId: string, id: string | null): Promise<{ partnerLogo: Uint8Array | null; partnerName: string | null }> {
  const none = { partnerLogo: null, partnerName: null };
  if (!id) return none;
  const [row] = (await forOrg(db, ctx).select(brandAssets, and(eq(brandAssets.id, id), eq(brandAssets.brandId, brandId), eq(brandAssets.kind, "partner"))!)) as (typeof brandAssets.$inferSelect)[];
  return row ? { partnerLogo: await storage.get(row.storageKey), partnerName: row.meta.name ?? null } : none;
}

/** The brand's example images (uploaded past posts), newest first, small JPEGs. */
export async function brandExamples(db: Db, storage: Storage, ctx: OrgContext, brandId: string, max = EXAMPLES_MAX): Promise<Uint8Array[]> {
  const rows = await db.select({ key: brandSources.storageKey }).from(brandSources)
    .where(and(eq(brandSources.orgId, ctx.orgId), eq(brandSources.brandId, brandId), eq(brandSources.kind, "image")))
    .orderBy(desc(brandSources.createdAt)).limit(max);
  const out: Uint8Array[] = [];
  for (const r of rows) {
    try {
      out.push(new Uint8Array(await sharp(await storage.get(r.key), { limitInputPixels: MAX_INPUT_PIXELS }).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()));
    } catch { /* an unreadable example is skipped */ }
  }
  return out;
}

export const toBlock = (jpeg: Uint8Array): ImageBlock => ({ mediaType: "image/jpeg", data: Buffer.from(jpeg).toString("base64") });
const pngToBlock = async (png: Uint8Array): Promise<ImageBlock> => toBlock(new Uint8Array(await sharp(png).resize({ width: 540 }).jpeg({ quality: 80 }).toBuffer()));

/** One template of a design as a PNG with its sample content, the brand logo and font, and a stand-in illustration. */
export async function renderPreview(spec: DesignSpec, templateId: string, shape: Shape, assets: { logo: Uint8Array | null; font: Uint8Array | null }) {
  const t = spec.templates.find((x) => x.id === templateId);
  if (!t) throw new DesignError("NOT_FOUND");
  return renderTemplate(spec, t, SHAPES[shape], { slots: t.sample, logo: assets.logo, brandFont: assets.font });
}

type DesignDeps = { llm: LlmClient; storage: Storage; now?: Date };

/** Worker: asks Claude, validates (one retry with the errors), stores the result. Never throws for expected outcomes. */
export async function runDesignJob(db: Db, deps: DesignDeps, job: DesignJob): Promise<"ready" | "failed" | "skipped"> {
  const [d] = await db.select().from(brandDesigns).where(eq(brandDesigns.id, job.designId));
  if (!d || d.status !== "generating") return "skipped";
  const fail = async (code: string) => {
    await db.update(brandDesigns).set({ status: "failed", error: code, updatedAt: new Date() }).where(and(eq(brandDesigns.id, d.id), eq(brandDesigns.status, "generating")));
    return "failed" as const;
  };
  let ctx: OrgContext;
  try {
    ctx = await resolveOrgContext(db, { userId: d.createdBy, activeOrganizationId: d.orgId });
  } catch (e) {
    if (e instanceof TenancyError) return fail("NO_ACCESS");
    throw e;
  }
  const detail = await getBrandDetail(db, ctx, d.brandId);
  const assets = await brandAssetBytes(db, deps.storage, ctx, d.brandId);
  const examples = await brandExamples(db, deps.storage, ctx, d.brandId);
  const logoBlock = assets.logo ? await pngToBlock(new Uint8Array(await sharp(assets.logo).flatten({ background: "#808080" }).png().toBuffer())) : null;
  const visual = detail.profile?.visual ?? { colors: {}, imageStyle: "", negativePrompt: "" };
  const inputs: DesignInputs = {
    brand: { name: detail.brand.name, website: detail.brand.website, languages: detail.brand.languages },
    cgp: detail.profile?.cgp ?? "", colors: visual.colors, imageStyle: visual.imageStyle, negativePrompt: visual.negativePrompt,
    brief: d.brief, hasLogo: !!assets.logo, brandFont: assets.fontFamily, examples: examples.map(toBlock), logo: logoBlock,
  };
  let base: DesignSpec | null = null;
  let previews: ImageBlock[] = [];
  if (d.instruction && d.basedOn) {
    const [prev] = await db.select().from(brandDesigns).where(and(eq(brandDesigns.id, d.basedOn), eq(brandDesigns.orgId, d.orgId)));
    if (!prev?.spec) return fail("NO_DESIGN");
    base = prev.spec;
    for (const t of base.templates) previews.push({ ...(await pngToBlock(await renderPreview(base, t.id, "portrait", assets))), caption: `Current template "${t.id}":` });
    previews = previews.slice(0, 8);
  }
  let invalid: { draft: unknown; errors: string } | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const req = base ? reviseDesignRequest(inputs, base, d.instruction!, previews, invalid) : createDesignRequest(inputs, invalid);
    let out;
    try {
      out = await cappedCall(db, deps.llm, { orgId: d.orgId, brandId: d.brandId, postId: null, now: deps.now }, req);
    } catch (e) {
      if (e instanceof SpendCapError) return fail("SPEND_CAP");
      // Keep the provider's status for diagnosis ("PROVIDER:anthropic 400 BadRequestError"); never request content.
      if (e instanceof LlmError) return fail(e.message && e.message !== e.code ? `${e.code}:${e.message}`.slice(0, 200) : e.code);
      throw e;
    }
    const parsed = designSpecSchema.safeParse(out.input);
    if (!parsed.success) { invalid = { draft: out.input, errors: issues(parsed.error) }; continue; }
    // A design that cannot be rendered is not saved.
    try {
      for (const t of parsed.data.templates) await renderTemplate(parsed.data, t, SHAPES.square, { slots: t.sample, logo: assets.logo, brandFont: assets.font });
    } catch {
      invalid = { draft: out.input, errors: "- the design could not be rendered; simplify the templates" };
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.update(brandDesigns).set({ status: "ready", spec: parsed.data, model: out.model, error: null, updatedAt: new Date() }).where(eq(brandDesigns.id, d.id));
      await tx.update(brands).set({ currentDesignId: d.id, updatedAt: new Date() }).where(and(eq(brands.id, d.brandId), eq(brands.orgId, d.orgId)));
    });
    return "ready";
  }
  return fail("INVALID_OUTPUT");
}
