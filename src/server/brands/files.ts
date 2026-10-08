// Brand file uploads (TASK-005b, ADR-033): logos, fonts and brand sources.
// Tenant separation: rows are read and written only through forOrg; S3 keys are built here from ids the server
// already verified (never from input); a URL is presigned only after the row was found in the caller's org.
import { createHash } from "node:crypto";
import { and, eq, getTableColumns, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { brandAssets, brands, brandSources, type AssetKind, type SourceKind } from "../db/schema";
import { inspectFont, woff2ToSfnt, woffToSfnt } from "../files/font";
import { reencodeImage } from "../files/images";
import { ExtractError, materialText } from "../files/extract";
import { CONTENT_TYPES, sniff, type Sniffed } from "../files/sniff";
import type { Storage } from "../files/storage";
import { unzip, type ZipEntry } from "../files/zip";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";

/** "partner" = a partner's logo (TASK-046), named, chosen per post or ad; never the brand's own logo. */
export type Slot = "logo" | "partner" | "font" | "source";

export class FileError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN" | "NOT_FOUND" | "ARCHIVED" | "EMPTY" | "TOO_LARGE" | "UNSUPPORTED_TYPE"
      | "INVALID_FILE" | "MISSING_GLYPHS" | "DUPLICATE" | "LIMIT_REACHED",
    public readonly detail?: string,
  ) {
    super(code);
  }
}

const MB = 1024 * 1024;
/** Upload size limits per slot (bytes, inclusive). */
export const MAX_BYTES: Record<Slot, number> = { logo: 10 * MB, partner: 10 * MB, font: 10 * MB, source: 50 * MB };
/** Files per brand and slot. */
export const MAX_FILES: Record<Slot, number> = { logo: 10, partner: 30, font: 20, source: 200 };

const ALLOWED: Record<Slot, Sniffed[]> = {
  logo: ["png", "jpeg", "webp"],
  partner: ["png", "jpeg", "webp"],
  font: ["ttf", "otf", "woff", "woff2"],
  source: ["pdf", "docx", "xlsx", "pptx", "text", "png", "jpeg", "webp"],
};

/** A partner's name: one line, ≤ 60 characters, never empty. */
export function partnerName(raw: string): string {
  return raw.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Partner";
}

/** Display name only: no path, no control characters, NFC, ≤ 200 chars. Never used for the storage key. */
export function cleanFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.normalize("NFC").replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, "").trim().slice(0, 200);
  return clean || "file";
}

const ID = /^[A-Za-z0-9_-]{1,100}$/;
/** org/<orgId>/brand/<brandId>/<kind>/<uuid>.<ext> — every part generated or verified server-side. */
export function storageKey(orgId: string, brandId: string, kind: string, ext: string): string {
  if (!ID.test(orgId) || !ID.test(brandId) || !/^[a-z]+$/.test(kind) || !/^[a-z0-9]+$/.test(ext)) throw new Error("BAD_KEY_PART");
  return `org/${orgId}/brand/${brandId}/${kind}/${crypto.randomUUID()}.${ext}`;
}

function requireOwner(ctx: OrgContext) {
  if (ctx.role !== "owner") throw new FileError("FORBIDDEN");
}

async function brandOf(db: Db, ctx: OrgContext, brandId: string) {
  const [b] = await forOrg(db, ctx).select(brands, eq(brands.id, brandId));
  if (!b) throw new FileError("NOT_FOUND");
  return b as typeof brands.$inferSelect;
}

const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
};

type Prepared = { bytes: Uint8Array; ext: string; contentType: string; table: "source" | "asset"; kind: SourceKind | AssetKind; meta: Record<string, unknown> };

/** Validates the bytes for the slot and returns what will be stored (images re-encoded). */
async function prepare(slot: Slot, filename: string, input: Uint8Array, brandLanguages: string[]): Promise<Prepared> {
  const type = sniff(input);
  if (type === "unknown" || !ALLOWED[slot].includes(type)) throw new FileError("UNSUPPORTED_TYPE", type);
  if (type === "png" || type === "jpeg" || type === "webp") {
    let img;
    try {
      img = await reencodeImage(input, slot === "logo" || slot === "partner" ? "logo" : "image");
    } catch {
      throw new FileError("INVALID_FILE");
    }
    const meta = { width: img.width, height: img.height };
    if (slot === "partner") return { bytes: img.bytes, ext: img.ext, contentType: img.contentType, table: "asset", kind: "partner", meta };
    return slot === "logo"
      ? { bytes: img.bytes, ext: img.ext, contentType: img.contentType, table: "asset", kind: "logo", meta }
      : { bytes: img.bytes, ext: img.ext, contentType: img.contentType, table: "source", kind: "image", meta };
  }
  if (type === "ttf" || type === "otf" || type === "woff" || type === "woff2") {
    // Web fonts are converted to TTF/OTF once here, because the renderer (Satori) cannot read WOFF2.
    let sfnt = input;
    let info;
    try {
      if (type === "woff") sfnt = woffToSfnt(input);
      if (type === "woff2") sfnt = await woff2ToSfnt(input);
      info = inspectFont(sfnt);
    } catch {
      throw new FileError("INVALID_FILE");
    }
    const flavor = sniff(sfnt);
    if (flavor !== "ttf" && flavor !== "otf") throw new FileError("INVALID_FILE");
    // Brands writing Slovenian need č š ž (and ć đ in names); others keep the font with the gap recorded.
    if (info.missingGlyphs.length && brandLanguages.includes("sl")) throw new FileError("MISSING_GLYPHS", info.missingGlyphs.join(" "));
    const meta = { family: info.family, missingGlyphs: info.missingGlyphs, ...(sfnt !== input ? { convertedFrom: type } : {}) };
    return { bytes: sfnt, ext: flavor, contentType: CONTENT_TYPES[flavor], table: "asset", kind: "font", meta };
  }
  if (type === "text") {
    const csv = /\.csv$/i.test(filename);
    return { bytes: input, ext: csv ? "csv" : "txt", contentType: csv ? "text/csv; charset=utf-8" : CONTENT_TYPES.text, table: "source", kind: csv ? "csv" : "text", meta: {} };
  }
  if (type === "pdf" || type === "docx" || type === "xlsx" || type === "pptx") {
    return { bytes: input, ext: type, contentType: CONTENT_TYPES[type], table: "source", kind: type, meta: {} };
  }
  throw new FileError("UNSUPPORTED_TYPE", type);
}

export type UploadResult = { id: string; table: "source" | "asset"; kind: SourceKind | AssetKind };

/** Owner only. Validates, stores in S3, then records the row; if the row cannot be written the object is removed. */
export async function uploadBrandFile(
  db: Db,
  storage: Storage,
  ctx: OrgContext,
  brandId: string,
  slot: Slot,
  file: { filename: string; bytes: Uint8Array; name?: string },
): Promise<UploadResult> {
  requireOwner(ctx);
  const brand = await brandOf(db, ctx, brandId);
  if (brand.archivedAt) throw new FileError("ARCHIVED");
  if (file.bytes.byteLength === 0) throw new FileError("EMPTY");
  if (file.bytes.byteLength > MAX_BYTES[slot]) throw new FileError("TOO_LARGE");

  const filename = cleanFilename(file.filename);
  const p = await prepare(slot, filename, file.bytes, brand.languages);
  // A partner logo carries the partner's name ("Polygon"), shown when choosing it; the file name by default.
  if (slot === "partner") p.meta.name = partnerName(file.name ?? filename.replace(/\.[^.]+$/, ""));
  const sha256 = createHash("sha256").update(file.bytes).digest("hex"); // of the original upload: same file twice = duplicate
  const table = p.table === "source" ? brandSources : brandAssets;
  const scoped = forOrg(db, ctx);

  const countWhere = p.table === "source" ? eq(brandSources.brandId, brandId) : and(eq(brandAssets.brandId, brandId), eq(brandAssets.kind, p.kind as AssetKind));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(and(eq(table.orgId, ctx.orgId), countWhere));
  if (n >= MAX_FILES[slot]) throw new FileError("LIMIT_REACHED");
  const [dup] = await scoped.select(table, and(eq(table.brandId, brandId), eq(table.sha256, sha256)));
  if (dup) throw new FileError("DUPLICATE");

  const id = crypto.randomUUID();
  const key = storageKey(ctx.orgId, brandId, p.kind, p.ext);
  // Material text is read once at upload (TASK-009); a document without text is still stored, marked failed.
  const text = p.table === "source" && p.kind !== "image" ? await extractSourceText(p.bytes, p.kind) : {};
  await storage.put(key, p.bytes, p.contentType);
  const row = {
    id, brandId, filename, storageKey: key, contentType: p.contentType, sizeBytes: p.bytes.byteLength, sha256, kind: p.kind, createdBy: ctx.userId,
    ...(p.table === "asset" ? { meta: p.meta } : text),
  };
  try {
    await scoped.insert(table, row);
  } catch (e) {
    await storage.delete(key).catch(() => {}); // compensate; the row is the source of truth
    if (isUniqueViolation(e)) throw new FileError("DUPLICATE");
    throw e;
  }
  return { id, table: p.table, kind: p.kind };
}

export type SourceText = { status?: "extracted" | "failed"; extract?: { text: string; chars: number }; error?: string | null };

/** Text of a source for generation; never throws (a failed read is recorded on the row, the upload still succeeds). */
export async function extractSourceText(bytes: Uint8Array, kind: string): Promise<SourceText> {
  try {
    const text = await materialText(bytes, kind);
    return { status: "extracted", extract: { text, chars: text.length }, error: null };
  } catch (e) {
    return { status: "failed", error: e instanceof ExtractError ? e.code : "INVALID_FILE" };
  }
}

/**
 * Sources uploaded before TASK-009 (status `uploaded`) are read on first need. Returns how many were read.
 * Rows are re-checked by org; each update is scoped too.
 */
export async function extractPendingSources(db: Db, storage: Storage, ctx: OrgContext, brandId: string): Promise<number> {
  const s = forOrg(db, ctx);
  const pending = (await s.select(brandSources, and(eq(brandSources.brandId, brandId), eq(brandSources.status, "uploaded"), ne(brandSources.kind, "image")))) as (typeof brandSources.$inferSelect)[];
  for (const r of pending) {
    const text = await extractSourceText(await storage.get(r.storageKey), r.kind);
    await s.update(brandSources, text, and(eq(brandSources.id, r.id), eq(brandSources.status, "uploaded")));
  }
  return pending.length;
}

/** Every member (owner or editor) can see a brand's files. The material text itself is not loaded, only its length. */
export async function listBrandFiles(db: Db, ctx: OrgContext, brandId: string) {
  await brandOf(db, ctx, brandId);
  const s = forOrg(db, ctx);
  const cols = Object.fromEntries(Object.entries(getTableColumns(brandSources)).filter(([k]) => k !== "extract")) as Omit<ReturnType<typeof getTableColumns<typeof brandSources>>, "extract">;
  const [sources, assets] = await Promise.all([
    db
      .select({ ...cols, textChars: sql<number | null>`(${brandSources.extract}->>'chars')::int` })
      .from(brandSources)
      .where(and(eq(brandSources.orgId, ctx.orgId), eq(brandSources.brandId, brandId))),
    s.select(brandAssets, eq(brandAssets.brandId, brandId)),
  ]);
  const byDate = <T extends { createdAt: Date }>(a: T, b: T) => b.createdAt.getTime() - a.createdAt.getTime();
  return {
    sources: sources.sort(byDate),
    logos: (assets as (typeof brandAssets.$inferSelect)[]).filter((a) => a.kind === "logo").sort(byDate),
    fonts: (assets as (typeof brandAssets.$inferSelect)[]).filter((a) => a.kind === "font").sort(byDate),
    partners: (assets as (typeof brandAssets.$inferSelect)[]).filter((a) => a.kind === "partner").sort((a, b) => (a.meta.name ?? "").localeCompare(b.meta.name ?? "", "sl")),
  };
}

async function findFile(db: Db, ctx: OrgContext, table: "source" | "asset", id: string) {
  const t = table === "source" ? brandSources : brandAssets;
  const [row] = await forOrg(db, ctx).select(t, eq(t.id, id));
  if (!row) throw new FileError("NOT_FOUND");
  return row as { id: string; storageKey: string; filename: string; contentType: string };
}

/** Short-lived URL for a file of the caller's org (any member). Images open inline, everything else downloads. */
export async function brandFileUrl(db: Db, storage: Storage, ctx: OrgContext, table: "source" | "asset", id: string) {
  const f = await findFile(db, ctx, table, id);
  const inline = f.contentType === "image/png" || f.contentType === "image/jpeg";
  return storage.presignGet(f.storageKey, { filename: f.filename, contentType: f.contentType, inline });
}

/** Owner only. The row goes first (access ends immediately), then the object. */
export async function deleteBrandFile(db: Db, storage: Storage, ctx: OrgContext, table: "source" | "asset", id: string) {
  requireOwner(ctx);
  const t = table === "source" ? brandSources : brandAssets;
  const [row] = (await forOrg(db, ctx).delete(t, eq(t.id, id))) as { storageKey: string }[];
  if (!row) throw new FileError("NOT_FOUND");
  // Access already ended with the row. A failed object delete leaves an orphan that nobody can reach; log the key only.
  await storage.delete(row.storageKey).catch((e) => console.error("brand file object not deleted", row.storageKey, (e as Error).name));
}

/** A ZIP upload may be larger than a single file; its entries still obey the per-slot limits. */
export const MAX_ZIP_BYTES = 100 * MB;

/** Where an upload goes when the owner just drops files: fonts → fonts, images named "logo…" → logos, rest → sources. */
export function classify(filename: string, type: Sniffed): Slot {
  if (type === "ttf" || type === "otf" || type === "woff" || type === "woff2") return "font";
  const base = (filename.split(/[\\/]/).pop() ?? "").toLowerCase();
  if ((type === "png" || type === "jpeg" || type === "webp") && /logo/.test(base)) return "logo";
  return "source";
}

export type AutoResult =
  | { name: string; ok: true; slot: Slot; table: "source" | "asset"; kind: SourceKind | AssetKind; id: string }
  | { name: string; ok: false; error: FileError["code"] | ZipError; detail?: string };
type ZipError = "ZIP_INVALID" | "ZIP_TOO_MANY_ENTRIES" | "ZIP_TOO_LARGE" | "ENCRYPTED" | "UNSUPPORTED_COMPRESSION" | "CORRUPT";

async function one(db: Db, storage: Storage, ctx: OrgContext, brandId: string, name: string, bytes: Uint8Array, slot?: Slot, partner?: string): Promise<AutoResult> {
  const target = slot ?? classify(name, sniff(bytes));
  try {
    const r = await uploadBrandFile(db, storage, ctx, brandId, target, { filename: name, bytes, name: partner });
    return { name, ok: true, slot: target, ...r };
  } catch (e) {
    if (e instanceof FileError) return { name, ok: false, error: e.code, detail: e.detail };
    throw e;
  }
}

/**
 * Owner drops anything: a single file goes to its slot (or the forced one), a plain ZIP is unpacked (safely, zip.ts)
 * and every entry is checked and filed on its own. Brand/role errors throw; per-file problems come back as results.
 */
export async function uploadAuto(
  db: Db,
  storage: Storage,
  ctx: OrgContext,
  brandId: string,
  file: { filename: string; bytes: Uint8Array; name?: string },
  slot?: Slot,
): Promise<AutoResult[]> {
  requireOwner(ctx);
  const brand = await brandOf(db, ctx, brandId);
  if (brand.archivedAt) throw new FileError("ARCHIVED");
  const name = cleanFilename(file.filename);
  if (slot || sniff(file.bytes) !== "zip") return [await one(db, storage, ctx, brandId, name, file.bytes, slot, file.name)];
  if (file.bytes.byteLength > MAX_ZIP_BYTES) return [{ name, ok: false, error: "TOO_LARGE" }];
  let entries: ZipEntry[];
  try {
    entries = unzip(file.bytes);
  } catch (e) {
    const code = (e as Error).message as ZipError;
    return [{ name, ok: false, error: ["ZIP_TOO_MANY_ENTRIES", "ZIP_TOO_LARGE"].includes(code) ? code : "ZIP_INVALID" }];
  }
  const out: AutoResult[] = [];
  for (const entry of entries) {
    const entryName = cleanFilename(entry.name);
    if (!entry.ok) { out.push({ name: entry.name, ok: false, error: entry.reason }); continue; }
    if (sniff(entry.bytes) === "zip") { out.push({ name: entry.name, ok: false, error: "UNSUPPORTED_TYPE", detail: "zip" }); continue; }
    const r = await one(db, storage, ctx, brandId, entryName, entry.bytes);
    out.push({ ...r, name: entry.name }); // show the path inside the archive
  }
  return out;
}

/** CGPs longer than this are refused (same limit as the profile editor). */
export const CGP_MAX_CHARS = 50_000;
export const CGP_IMPORT_MAX_BYTES = 20 * MB;

export class CgpImportError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "NOT_FOUND" | "ARCHIVED" | "TOO_LARGE" | "UNSUPPORTED_TYPE" | "INVALID_FILE" | "NO_TEXT" | "TOO_LONG", public readonly detail?: string) {
    super(code);
  }
}

/**
 * Owner only: the text of a document — uploaded now, or one of the brand's sources — for the CGP editor (ADR-037).
 * Nothing is saved here; the owner reviews it in the editor and saves a new profile version.
 */
export async function cgpTextFromDocument(
  db: Db,
  storage: Storage,
  ctx: OrgContext,
  brandId: string,
  from: { file: { filename: string; bytes: Uint8Array } } | { sourceId: string },
): Promise<{ text: string; filename: string; kind: "pdf" | "docx" | "text" }> {
  if (ctx.role !== "owner") throw new CgpImportError("FORBIDDEN");
  const brand = await brandOf(db, ctx, brandId).catch(() => { throw new CgpImportError("NOT_FOUND"); });
  if (brand.archivedAt) throw new CgpImportError("ARCHIVED");
  let filename: string;
  let bytes: Uint8Array;
  if ("file" in from) {
    filename = cleanFilename(from.file.filename);
    bytes = from.file.bytes;
  } else {
    const [src] = (await forOrg(db, ctx).select(brandSources, and(eq(brandSources.id, from.sourceId), eq(brandSources.brandId, brandId)))) as (typeof brandSources.$inferSelect)[];
    if (!src) throw new CgpImportError("NOT_FOUND");
    filename = src.filename;
    bytes = await storage.get(src.storageKey);
  }
  if (bytes.byteLength > CGP_IMPORT_MAX_BYTES) throw new CgpImportError("TOO_LARGE");
  const { documentText, ExtractError } = await import("../files/extract");
  let r;
  try {
    r = await documentText(bytes);
  } catch (e) {
    if (e instanceof ExtractError) throw new CgpImportError(e.code);
    throw e;
  }
  if (r.text.length > CGP_MAX_CHARS) throw new CgpImportError("TOO_LONG", String(r.text.length));
  return { text: r.text, filename, kind: r.kind };
}
