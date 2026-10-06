import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "../db/client";
import { brandAssets, brandProfileVersions, brands, cgpDrafts, channels, formatPresets, orgSettings } from "../db/schema";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { brandInput, channelInput, profileInput, templateSchema, visualSchema } from "./schemas";

export class BrandError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "NOT_FOUND" | "LIMIT_REACHED" | "DUPLICATE" | "PRESET_MISMATCH" | "ARCHIVED" | "LANGUAGE_NOT_IN_BRAND") {
    super(code);
  }
}

/** Brand configuration is the owner's job (spec §2); editors read it and work on content. */
function requireOwner(ctx: OrgContext) {
  if (ctx.role !== "owner") throw new BrandError("FORBIDDEN");
}

const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
};

const EMPTY_PROFILE = {
  cgp: "",
  rules: { bannedWords: [], ctaPhrases: [], regexMust: [], regexMustNot: [] },
  pillars: [],
  visual: { colors: {}, imageStyle: "", negativePrompt: "" },
};

/** Loads a brand of the context's org or throws NOT_FOUND (also for another org's id). */
async function ownBrand(db: Db, ctx: OrgContext, brandId: string) {
  const [b] = await forOrg(db, ctx).select(brands, eq(brands.id, brandId));
  if (!b) throw new BrandError("NOT_FOUND");
  return b as typeof brands.$inferSelect;
}

export async function createBrand(db: Db, ctx: OrgContext, input: z.input<typeof brandInput>) {
  requireOwner(ctx);
  const data = brandInput.parse(input);
  const [settings] = await db.select({ limits: orgSettings.limits }).from(orgSettings).where(eq(orgSettings.orgId, ctx.orgId));
  const max = settings?.limits?.brands;
  if (max !== undefined) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(brands)
      .where(and(eq(brands.orgId, ctx.orgId), isNull(brands.archivedAt)));
    if (n >= max) throw new BrandError("LIMIT_REACHED");
  }
  const id = crypto.randomUUID();
  try {
    await db.transaction(async (tx) => {
      const t = forOrg(tx as unknown as Db, ctx);
      await t.insert(brands, { id, ...data, website: data.website ?? null });
      const vId = crypto.randomUUID();
      await t.insert(brandProfileVersions, { id: vId, brandId: id, version: 1, ...EMPTY_PROFILE, createdBy: ctx.userId, note: "created" });
      await t.update(brands, { currentProfileVersionId: vId }, eq(brands.id, id));
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new BrandError("DUPLICATE");
    throw e;
  }
  return { id };
}

export async function updateBrand(db: Db, ctx: OrgContext, brandId: string, input: z.input<typeof brandInput>) {
  requireOwner(ctx);
  const data = brandInput.parse(input);
  await ownBrand(db, ctx, brandId);
  try {
    const rows = await forOrg(db, ctx).update(brands, { ...data, website: data.website ?? null, updatedAt: new Date() }, eq(brands.id, brandId));
    return rows[0];
  } catch (e) {
    if (isUniqueViolation(e)) throw new BrandError("DUPLICATE");
    throw e;
  }
}

export async function setBrandArchived(db: Db, ctx: OrgContext, brandId: string, archived: boolean) {
  requireOwner(ctx);
  await ownBrand(db, ctx, brandId);
  await forOrg(db, ctx).update(brands, { archivedAt: archived ? new Date() : null, updatedAt: new Date() }, eq(brands.id, brandId));
}

/**
 * Saves the CGP/profile as a NEW version (spec §4 versioning). The brand row is locked so concurrent saves
 * get consecutive version numbers; old versions are never changed.
 */
export async function saveProfile(db: Db, ctx: OrgContext, brandId: string, input: z.input<typeof profileInput>) {
  requireOwner(ctx);
  const data = profileInput.parse(input);
  return db.transaction(async (tx) => {
    const [b] = await tx
      .select({ id: brands.id, archivedAt: brands.archivedAt })
      .from(brands)
      .where(and(eq(brands.id, brandId), eq(brands.orgId, ctx.orgId)))
      .for("update");
    if (!b) throw new BrandError("NOT_FOUND");
    if (b.archivedAt) throw new BrandError("ARCHIVED");
    const [{ max }] = await tx
      .select({ max: sql<number>`coalesce(max(${brandProfileVersions.version}), 0)::int` })
      .from(brandProfileVersions)
      .where(eq(brandProfileVersions.brandId, brandId));
    // The image template is edited on its own tab; a profile save without one keeps the current template.
    if (!data.visual.template) {
      const [cur] = await tx
        .select({ visual: brandProfileVersions.visual })
        .from(brandProfileVersions)
        .where(and(eq(brandProfileVersions.brandId, brandId), eq(brandProfileVersions.orgId, ctx.orgId)))
        .orderBy(desc(brandProfileVersions.version))
        .limit(1);
      if (cur?.visual.template) data.visual.template = cur.visual.template;
    }
    const id = crypto.randomUUID();
    const t = forOrg(tx as unknown as Db, ctx);
    await t.insert(brandProfileVersions, { id, brandId, version: max + 1, ...data, createdBy: ctx.userId });
    await t.update(brands, { currentProfileVersionId: id, updatedAt: new Date() }, eq(brands.id, brandId));
    // A saved version settles any CGP draft Claude sent for this brand (ADR-038).
    await t.update(cgpDrafts, { status: "used", resolvedAt: new Date() }, and(eq(cgpDrafts.brandId, brandId), eq(cgpDrafts.status, "pending")));
    return { id, version: max + 1 };
  });
}

export const TEMPLATE_NOTE = "image-template";

/**
 * Owner saves the image template and colours (TASK-015) as a new profile version; CGP, rules and pillars stay as they
 * are. A chosen logo or font must be one of this brand's own assets.
 */
export async function saveImageTemplate(
  db: Db, ctx: OrgContext, brandId: string,
  input: { template: z.input<typeof templateSchema>; colors: { background?: string; text?: string; accent?: string } },
) {
  requireOwner(ctx);
  const { profile } = await getBrandDetail(db, ctx, brandId);
  if (!profile) throw new BrandError("NOT_FOUND");
  const template = templateSchema.parse(input.template);
  for (const [id, kind] of [[template.logoId, "logo"], [template.fontId, "font"]] as const) {
    if (!id || id === "none") continue;
    const [a] = await forOrg(db, ctx).select(brandAssets, and(eq(brandAssets.id, id), eq(brandAssets.brandId, brandId), eq(brandAssets.kind, kind)));
    if (!a) throw new BrandError("NOT_FOUND");
  }
  if (template.fontId === "none") template.fontId = null;
  const visual = visualSchema.parse({ ...profile.visual, colors: { ...profile.visual.colors, ...input.colors }, template });
  return saveProfile(db, ctx, brandId, { cgp: profile.cgp, rules: profile.rules, pillars: profile.pillars, visual, note: TEMPLATE_NOTE });
}

async function checkPreset(db: Db, platform: string, key?: string) {
  if (!key) return;
  const [p] = await db.select({ platform: formatPresets.platform, enabled: formatPresets.enabled }).from(formatPresets).where(eq(formatPresets.key, key));
  if (!p || !p.enabled || p.platform !== platform) throw new BrandError("PRESET_MISMATCH");
}

export async function addChannel(db: Db, ctx: OrgContext, brandId: string, input: z.input<typeof channelInput>) {
  requireOwner(ctx);
  const data = channelInput.parse(input);
  const b = await ownBrand(db, ctx, brandId);
  if (b.archivedAt) throw new BrandError("ARCHIVED");
  // A channel posts in one of the brand's languages (an English-only brand cannot get a Slovenian channel).
  if (!b.languages.includes(data.language)) throw new BrandError("LANGUAGE_NOT_IN_BRAND");
  await checkPreset(db, data.platform, data.defaultPresetKey);
  const id = crypto.randomUUID();
  try {
    await forOrg(db, ctx).insert(channels, { id, brandId, ...data, defaultPresetKey: data.defaultPresetKey ?? null });
  } catch (e) {
    if (isUniqueViolation(e)) throw new BrandError("DUPLICATE");
    throw e;
  }
  return { id };
}

export async function updateChannel(db: Db, ctx: OrgContext, channelId: string, input: z.input<typeof channelInput>) {
  requireOwner(ctx);
  const data = channelInput.parse(input);
  const [ch] = (await forOrg(db, ctx).select(channels, eq(channels.id, channelId))) as (typeof channels.$inferSelect)[];
  if (!ch) throw new BrandError("NOT_FOUND");
  const b = await ownBrand(db, ctx, ch.brandId);
  if (!b.languages.includes(data.language)) throw new BrandError("LANGUAGE_NOT_IN_BRAND");
  await checkPreset(db, data.platform, data.defaultPresetKey);
  const rows = await forOrg(db, ctx).update(channels, { ...data, defaultPresetKey: data.defaultPresetKey ?? null, updatedAt: new Date() }, eq(channels.id, channelId));
  if (!rows[0]) throw new BrandError("NOT_FOUND");
  return rows[0];
}

export async function removeChannel(db: Db, ctx: OrgContext, channelId: string) {
  requireOwner(ctx);
  const rows = await forOrg(db, ctx).delete(channels, eq(channels.id, channelId));
  if (!rows[0]) throw new BrandError("NOT_FOUND");
}

// ---- reads (owner and editor) ----

export async function listBrands(db: Db, ctx: OrgContext, opts: { includeArchived?: boolean } = {}) {
  const rows = (await forOrg(db, ctx).select(brands, opts.includeArchived ? undefined : isNull(brands.archivedAt))) as (typeof brands.$inferSelect)[];
  return rows.sort((a, b) => a.name.localeCompare(b.name, "sl"));
}

export async function getBrandDetail(db: Db, ctx: OrgContext, brandId: string) {
  const brand = await ownBrand(db, ctx, brandId);
  const s = forOrg(db, ctx);
  const [profile] = brand.currentProfileVersionId
    ? ((await s.select(brandProfileVersions, eq(brandProfileVersions.id, brand.currentProfileVersionId))) as (typeof brandProfileVersions.$inferSelect)[])
    : [];
  const chans = (await s.select(channels, eq(channels.brandId, brandId))) as (typeof channels.$inferSelect)[];
  return { brand, profile: profile ?? null, channels: chans.sort((a, b) => a.platform.localeCompare(b.platform)) };
}

export async function listProfileVersions(db: Db, ctx: OrgContext, brandId: string) {
  await ownBrand(db, ctx, brandId);
  return db
    .select({ id: brandProfileVersions.id, version: brandProfileVersions.version, note: brandProfileVersions.note, createdAt: brandProfileVersions.createdAt })
    .from(brandProfileVersions)
    .where(and(eq(brandProfileVersions.brandId, brandId), eq(brandProfileVersions.orgId, ctx.orgId)))
    .orderBy(desc(brandProfileVersions.version));
}
