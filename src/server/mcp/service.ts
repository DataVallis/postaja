// What Claude can do in Postaja through MCP (TASK-010, ADR-038). Every function takes a verified OrgContext, reads
// and writes only through forOrg and the existing services, and applies the same owner/editor rules as the app.
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { CGP_MAX_CHARS, listBrandFiles, uploadAuto, uploadBrandFile, type Slot } from "../brands/files";
import { LANGUAGES } from "../brands/schemas";
import { BrandError, createBrandNamed, getBrandDetail, listBrands } from "../brands/service";
import { slugify } from "@/lib/slug";
import type { Db } from "../db/client";
import { brands, cgpDrafts, mcpToolCalls } from "../db/schema";
import type { Storage } from "../files/storage";
import { FetchError, fetchPublicFile, type FetchFile } from "../files/fetch-public";
import { firstMembershipOrgId } from "../orgs/invitations";
import { resolveOrgContext, TenancyError, type OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";

export class McpError extends Error {
  constructor(public readonly code: "NO_ORGANIZATION" | "NOT_FOUND" | "FORBIDDEN" | "ARCHIVED" | "INVALID" | "TOO_LONG" | "TOO_LARGE", message: string) {
    super(message);
  }
}

/** The organization a token's user works in: the first membership, re-verified like every app request. */
export async function mcpContext(db: Db, userId: string): Promise<OrgContext> {
  const orgId = await firstMembershipOrgId(db, userId);
  if (!orgId) throw new McpError("NO_ORGANIZATION", "Your Postaja account is not a member of any organization.");
  try {
    return await resolveOrgContext(db, { userId, activeOrganizationId: orgId });
  } catch (e) {
    if (e instanceof TenancyError) throw new McpError("NO_ORGANIZATION", "Your organization is not available (suspended or removed).");
    throw e;
  }
}

/**
 * A brand by id, slug or name (Claude will usually say "inzenirji", "Inženirji" or "aibuilders.si"), in this org only.
 * Names are compared by their short form, so "Inženirji" finds the brand "inzenirji".
 */
export async function findBrand(db: Db, ctx: OrgContext, ref: string) {
  const b = await lookupBrand(db, ctx, ref);
  if (!b) throw new McpError("NOT_FOUND", `No brand "${ref}" in ${ctx.orgName}. Use list_brands to see the brands, or create_brand to add it.`);
  return b;
}

async function lookupBrand(db: Db, ctx: OrgContext, ref: string) {
  const all = (await forOrg(db, ctx).select(brands)) as (typeof brands.$inferSelect)[];
  const r = ref.trim();
  const short = slugify(r);
  return all.find((b) => b.id === r) ?? all.find((b) => b.slug === r.toLowerCase()) ?? all.find((b) => b.name.toLowerCase() === r.toLowerCase())
    ?? (short ? all.find((b) => b.slug === short || slugify(b.name) === short) : undefined);
}

export const createBrandInput = z.object({
  name: z.string().trim().min(2).max(80),
  website: z.string().trim().max(200).optional(),
  languages: z.array(z.enum(LANGUAGES)).min(1).max(5).optional(),
});

/**
 * Owner only. Returns the existing brand when one matches the name (id, slug or name), otherwise creates it with a
 * short name made from the name (made unique) — a new project from Claude lands in Postaja in one step.
 */
export async function ensureBrand(db: Db, ctx: OrgContext, input: z.input<typeof createBrandInput>, appUrl: string) {
  const data = createBrandInput.parse(input);
  const existing = await lookupBrand(db, ctx, data.name);
  if (existing) return { id: existing.id, slug: existing.slug, name: existing.name, created: false, url: `${appUrl}/app/brands/${existing.id}` };
  requireOwner(ctx, "create brands");
  try {
    const { id, slug } = await createBrandNamed(db, ctx, { name: data.name, website: data.website, languages: data.languages });
    return { id, slug, name: data.name, created: true, url: `${appUrl}/app/brands/${id}` };
  } catch (e) {
    if (e instanceof BrandError && e.code === "LIMIT_REACHED") throw new McpError("FORBIDDEN", "The organization has reached its number of brands.");
    if (e instanceof z.ZodError) throw new McpError("INVALID", "The brand name or website is not valid.");
    throw e;
  }
}

/** The brand a tool works on: found by id/slug/name, or created (owner) when `create` is set and none matches. */
async function brandFor(db: Db, ctx: OrgContext, ref: string, create: boolean, appUrl: string, languages?: (typeof LANGUAGES)[number][]) {
  const found = await lookupBrand(db, ctx, ref);
  if (found) return { brand: found, created: false };
  // An id that matches nothing (another org's brand, a typo) is never turned into a brand name.
  if (!create || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(ref.trim())) return { brand: await findBrand(db, ctx, ref), created: false };
  const made = await ensureBrand(db, ctx, { name: ref, languages }, appUrl);
  return { brand: await findBrand(db, ctx, made.id), created: true };
}

const requireOwner = (ctx: OrgContext, what: string) => {
  if (ctx.role !== "owner") throw new McpError("FORBIDDEN", `Only the organization owner can ${what}.`);
};

export async function mcpListBrands(db: Db, ctx: OrgContext) {
  const list = await listBrands(db, ctx);
  return Promise.all(
    list.map(async (b) => {
      const d = await getBrandDetail(db, ctx, b.id);
      return {
        id: b.id, slug: b.slug, name: b.name, languages: b.languages, website: b.website ?? null,
        channels: d.channels.map((c) => ({ id: c.id, platform: c.platform, handle: c.handle, language: c.language })),
      };
    }),
  );
}

export async function mcpGetBrand(db: Db, ctx: OrgContext, ref: string) {
  const b = await findBrand(db, ctx, ref);
  const d = await getBrandDetail(db, ctx, b.id);
  const files = await listBrandFiles(db, ctx, b.id);
  return {
    id: b.id, slug: b.slug, name: b.name, languages: b.languages, archived: !!b.archivedAt,
    cgp: d.profile?.cgp ?? "", profileVersion: d.profile?.version ?? 0,
    rules: d.profile?.rules ?? null, pillars: d.profile?.pillars ?? [],
    channels: d.channels.map((c) => ({ id: c.id, platform: c.platform, handle: c.handle, language: c.language })),
    materials: files.sources.map((s) => ({ filename: s.filename, kind: s.kind, textChars: s.textChars ?? 0 })),
    logos: files.logos.length, fonts: files.fonts.map((f) => f.meta.family ?? f.filename),
  };
}

export const proposeCgpInput = z.object({
  brand: z.string().min(1), cgp: z.string().trim().min(1), note: z.string().trim().max(500).optional(),
  create_if_missing: z.boolean().optional(), languages: z.array(z.enum(LANGUAGES)).min(1).max(5).optional(),
});

/**
 * Owner only. Stores the text as a pending draft (earlier pending drafts of the brand are discarded). It never changes
 * the active CGP: the owner opens the brand, inserts the draft into the editor and saves a version (ADR-035, ADR-038).
 */
export async function proposeCgp(db: Db, ctx: OrgContext, input: z.input<typeof proposeCgpInput>, appUrl: string) {
  requireOwner(ctx, "propose a CGP");
  const data = proposeCgpInput.parse(input);
  if (data.cgp.length > CGP_MAX_CHARS) throw new McpError("TOO_LONG", `The CGP has ${data.cgp.length} characters; the maximum is ${CGP_MAX_CHARS}.`);
  const { brand: b, created } = await brandFor(db, ctx, data.brand, data.create_if_missing ?? true, appUrl, data.languages);
  if (b.archivedAt) throw new McpError("ARCHIVED", "The brand is archived.");
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    const t = forOrg(tx as unknown as Db, ctx);
    await t.update(cgpDrafts, { status: "discarded", resolvedAt: new Date() }, and(eq(cgpDrafts.brandId, b.id), eq(cgpDrafts.status, "pending")));
    await t.insert(cgpDrafts, { id, brandId: b.id, text: data.cgp, note: data.note ?? null, source: "claude", createdBy: ctx.userId });
  });
  return { draftId: id, brand: b.name, brandCreated: created, reviewUrl: `${appUrl}/app/brands/${b.id}?tab=profile`, chars: data.cgp.length };
}

export async function pendingDraft(db: Db, ctx: OrgContext, brandId: string) {
  const [d] = (await forOrg(db, ctx).select(cgpDrafts, and(eq(cgpDrafts.brandId, brandId), eq(cgpDrafts.status, "pending")))) as (typeof cgpDrafts.$inferSelect)[];
  return d ?? null;
}

export async function discardDraft(db: Db, ctx: OrgContext, draftId: string) {
  requireOwner(ctx, "discard a CGP draft");
  const rows = await forOrg(db, ctx).update(cgpDrafts, { status: "discarded", resolvedAt: new Date() }, and(eq(cgpDrafts.id, draftId), eq(cgpDrafts.status, "pending")));
  if (!rows.length) throw new McpError("NOT_FOUND", "No such pending draft.");
}

export const addMaterialInput = z.object({
  brand: z.string().min(1),
  filename: z.string().trim().min(1).max(200),
  text: z.string().min(1).max(2_000_000),
  create_if_missing: z.boolean().optional(),
});

/** Owner only. Text from the conversation becomes a brand material (Markdown unless the name says .txt/.csv). */
export async function addTextMaterial(db: Db, storage: Storage, ctx: OrgContext, input: z.input<typeof addMaterialInput>, appUrl = "") {
  requireOwner(ctx, "add materials");
  const data = addMaterialInput.parse(input);
  const { brand: b } = await brandFor(db, ctx, data.brand, data.create_if_missing ?? true, appUrl);
  const filename = /\.(md|txt|csv)$/i.test(data.filename) ? data.filename : `${data.filename}.md`;
  const r = await uploadBrandFile(db, storage, ctx, b.id, "source", { filename, bytes: new TextEncoder().encode(data.text) });
  return { id: r.id, brand: b.name, filename, kind: r.kind };
}

/** Base64 files over the connection: logos, a few past posts and documents fit; bigger ones go through the upload page. */
export const FILE_MAX_BYTES = 15 * 1024 * 1024;
export const FILE_KINDS = ["auto", "logo", "font", "post_example", "material"] as const;

export const addFileInput = z.object({
  brand: z.string().min(1),
  filename: z.string().trim().min(1).max(200).optional(),
  content_base64: z.string().min(4).optional(),
  url: z.string().trim().max(2000).optional(),
  kind: z.enum(FILE_KINDS).optional(),
  create_if_missing: z.boolean().optional(),
});

/** The file's bytes: sent inline as base64 (small files) or fetched by Postaja from a public URL. */
async function fileBytes(data: z.output<typeof addFileInput>, fetchFile: FetchFile): Promise<{ filename: string; bytes: Uint8Array }> {
  if (!!data.content_base64 === !!data.url) throw new McpError("INVALID", "Send exactly one of content_base64 or url.");
  if (data.url) {
    try {
      const f = await fetchFile(data.url, { maxBytes: FILE_MAX_BYTES });
      if (!f.bytes.length) throw new McpError("INVALID", "The file at the URL is empty.");
      return { filename: data.filename ?? withExtension(f.filename, f.contentType), bytes: f.bytes };
    } catch (e) {
      if (e instanceof FetchError) {
        if (e.code === "TOO_LARGE") throw new McpError("TOO_LARGE", `The file is larger than ${FILE_MAX_BYTES / 1024 / 1024} MB. Use upload_link and let the owner drop it in Postaja.`);
        throw new McpError("INVALID", `Could not download the file: ${e.message}`);
      }
      throw e;
    }
  }
  if (!data.filename) throw new McpError("INVALID", "filename is required with content_base64.");
  const clean = data.content_base64!.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new McpError("INVALID", "content_base64 is not valid base64.");
  if (Math.floor((clean.length * 3) / 4) > FILE_MAX_BYTES + 3) throw new McpError("TOO_LARGE", `The file is larger than ${FILE_MAX_BYTES / 1024 / 1024} MB. Use upload_link and let the owner drop it in Postaja.`);
  const bytes = new Uint8Array(Buffer.from(clean, "base64"));
  if (!bytes.length) throw new McpError("INVALID", "The file is empty.");
  return { filename: data.filename, bytes };
}

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf", "text/plain": "txt", "text/csv": "csv",
  "text/markdown": "md", "font/ttf": "ttf", "font/otf": "otf", "font/woff": "woff", "font/woff2": "woff2", "application/zip": "zip",
};
/** URL paths often lack an extension (CDNs); the upload sorter reads names, so add one from the content type. */
function withExtension(name: string, contentType: string | null): string {
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name;
  const ext = contentType ? EXT_BY_TYPE[contentType.split(";")[0].trim().toLowerCase()] : undefined;
  return ext ? `${name}.${ext}` : name;
}

/**
 * Owner only (TASK-010b). A file from the conversation (logo, image of a past post, PDF/Word/Excel material, font,
 * or a ZIP of them) goes through the same checks as an upload in Postaja: re-encoded images, sniffed types, font
 * glyph check, text read from documents. "post_example" images become examples for the visual identity.
 */
export async function addFile(db: Db, storage: Storage, ctx: OrgContext, input: z.input<typeof addFileInput>, appUrl: string, fetchFile: FetchFile = fetchPublicFile) {
  requireOwner(ctx, "add files");
  const data = addFileInput.parse(input);
  const { filename, bytes } = await fileBytes(data, fetchFile);
  const { brand: b, created } = await brandFor(db, ctx, data.brand, data.create_if_missing ?? true, appUrl);
  const kind = data.kind ?? "auto";
  const slot: Slot | undefined = kind === "logo" ? "logo" : kind === "font" ? "font" : kind === "post_example" || kind === "material" ? "source" : undefined;
  const results = await uploadAuto(db, storage, ctx, b.id, { filename, bytes }, slot);
  return {
    brand: b.name, brandCreated: created, filesUrl: `${appUrl}/app/brands/${b.id}?tab=files`,
    files: results.map((r) => (r.ok ? { name: r.name, ok: true, savedAs: r.kind } : { name: r.name, ok: false, error: r.error, detail: r.detail ?? null })),
  };
}

/** For files too big for the connection: the brand's Files page, where the signed-in owner drops them. */
export async function uploadLink(db: Db, ctx: OrgContext, ref: string, appUrl: string) {
  const b = await findBrand(db, ctx, ref);
  return { brand: b.name, url: `${appUrl}/app/brands/${b.id}?tab=files`, note: "Open the link in Postaja (signed in) and drop the files; ZIP folders are unpacked and sorted." };
}

/** One row per tool call: who, org, client, tool, outcome. Arguments are not stored (they may hold brand material). */
export async function logToolCall(db: Db, row: { orgId: string | null; userId: string; clientId: string; tool: string; error?: string }) {
  await db.insert(mcpToolCalls).values({ id: crypto.randomUUID(), ...row, ok: row.error ? "error" : "ok", error: row.error ?? null });
}

export async function recentToolCalls(db: Db, ctx: OrgContext, limit = 20) {
  return db.select().from(mcpToolCalls).where(and(eq(mcpToolCalls.orgId, ctx.orgId), eq(mcpToolCalls.userId, ctx.userId))).orderBy(desc(mcpToolCalls.createdAt)).limit(limit);
}
