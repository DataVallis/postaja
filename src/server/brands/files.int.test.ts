import fs from "node:fs";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { image, makeFont, makeZip, OOXML, pdf } from "../../../tests/fixtures/files";
import { crossTenantSuite } from "../../../tests/tenancy/harness";
import { brandAssets, brandSources } from "../db/schema";
import { REQUIRED_GLYPHS } from "../files/font";
import { createS3Storage, s3ConfigFromEnv, type Storage } from "../files/storage";
import { createOrganization, inviteMember } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { createBrand, setBrandArchived } from "./service";
import { sniff } from "../files/sniff";
import { brandFileUrl, cleanFilename, deleteBrandFile, listBrandFiles, MAX_BYTES, MAX_FILES, uploadBrandFile } from "./files";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const deps = { mailer, baseURL: "http://localhost:3000" };
const s3 = createS3Storage(s3ConfigFromEnv());

let A: OrgContext;
let B: OrgContext;
let editorA: OrgContext;
let brandA: string;
let brandB: string;

/** Structurally valid but without outlines: passes the coverage checks, the renderer cannot draw it. */
const font = (chars = `abc${REQUIRED_GLYPHS}`) => makeFont({ chars, family: "Brand Sans" });
/** Real fonts from tests/fixtures/fonts (TinySans: full coverage; TinyPlain: no č š ž; TinySansVar: variable). */
const realFont = (name: "TinySans" | "TinyPlain" | "TinySansVar") => new Uint8Array(fs.readFileSync(`tests/fixtures/fonts/${name}.ttf`));
const fetchBytes = async (u: string) => {
  const r = await fetch(u);
  return { status: r.status, type: r.headers.get("content-type"), disposition: r.headers.get("content-disposition"), body: new Uint8Array(await r.arrayBuffer()) };
};

beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, channels, brand_sources, brand_assets cascade`;
  const s = (await session((await signIn("boss@datavallis.com"))!))!;
  const actor = { userId: s.user.id, role: "superadmin" as const };
  const a = await createOrganization(db, deps, actor, { name: "Org A", slug: "org-a", plan: "pro", ownerEmail: "boss@datavallis.com" });
  const b = await createOrganization(db, deps, actor, { name: "Org B", slug: "org-b", plan: "pro", ownerEmail: "b@b.si" });
  const bUser = (await session((await signIn("b@b.si"))!))!.user;
  await inviteMember(db, deps, actor, a.orgId, { email: "ed@a.si", role: "editor" });
  const edUser = (await session((await signIn("ed@a.si"))!))!.user;
  A = { userId: s.user.id, orgId: a.orgId, orgName: "Org A", role: "owner", plan: "pro" };
  B = { userId: bUser.id, orgId: b.orgId, orgName: "Org B", role: "owner", plan: "pro" };
  editorA = { userId: edUser.id, orgId: a.orgId, orgName: "Org A", role: "editor", plan: "pro" };
  brandA = (await createBrand(db, A, { name: "Inženirji", slug: "inzenirji", languages: ["sl"] })).id;
  brandB = (await createBrand(db, B, { name: "Cherr", slug: "cherr", languages: ["en"] })).id;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

describe("upload → S3 → row", () => {
  it("source PDF: key is org/<org>/brand/<brand>/pdf/<uuid>.pdf, bytes stored unchanged, presigned URL downloads it", async () => {
    const bytes = pdf("cenik");
    const r = await uploadBrandFile(db, s3, A, brandA, "source", { filename: "../../etc/Cenik 2026 – č.pdf", bytes });
    expect(r).toMatchObject({ table: "source", kind: "pdf" });
    const [row] = await db.select().from(brandSources).where(eq(brandSources.id, r.id));
    expect(row.storageKey).toMatch(new RegExp(`^org/${A.orgId}/brand/${brandA}/pdf/[0-9a-f-]{36}\\.pdf$`));
    expect(row).toMatchObject({ orgId: A.orgId, filename: "Cenik 2026 – č.pdf", contentType: "application/pdf", sizeBytes: bytes.length, status: "failed", error: "INVALID_FILE", createdBy: A.userId }); // the stub PDF has no readable text (TASK-009)
    const got = await fetchBytes(await brandFileUrl(db, s3, A, "source", r.id));
    expect(got.status).toBe(200);
    expect(got.body).toEqual(bytes);
    expect(got.type).toBe("application/pdf");
    expect(got.disposition).toContain("attachment;");
    expect(got.disposition).toContain("filename*=UTF-8''Cenik%202026%20%E2%80%93%20%C4%8D.pdf");
  });

  it("every accepted source type gets its kind and extension from the bytes, not the name", async () => {
    const cases: [string, Uint8Array, string, string][] = [
      ["brief.pdf.docx", makeZip(OOXML.docx), "docx", "docx"],
      ["data", makeZip(OOXML.xlsx), "xlsx", "xlsx"],
      ["deck.key", makeZip(OOXML.pptx), "pptx", "pptx"],
      ["izdelki.csv", new TextEncoder().encode("ime;cena\nčaj;3\n"), "csv", "csv"],
      ["notes.md", new TextEncoder().encode("# Ton\nToplo, strokovno."), "text", "txt"],
      ["photo.png", await image("jpeg"), "image", "jpg"],
    ];
    for (const [filename, bytes, kind, ext] of cases) {
      const r = await uploadBrandFile(db, s3, A, brandA, "source", { filename, bytes });
      const [row] = await db.select().from(brandSources).where(eq(brandSources.id, r.id));
      expect([row.kind, row.storageKey.split(".").pop()], filename).toEqual([kind, ext]);
    }
  });

  it("logo is re-encoded to PNG without metadata and opens inline", async () => {
    const r = await uploadBrandFile(db, s3, A, brandA, "logo", { filename: "logo.jpg", bytes: await image("jpeg", 300, 100, { exif: true }) });
    const [row] = await db.select().from(brandAssets).where(eq(brandAssets.id, r.id));
    expect(row).toMatchObject({ kind: "logo", contentType: "image/png", meta: { width: 300, height: 100 } });
    const got = await fetchBytes(await brandFileUrl(db, s3, A, "asset", r.id));
    expect(got.disposition).toMatch(/^inline;/);
    const meta = await sharp(got.body).metadata();
    expect([meta.format, meta.exif]).toEqual(["png", undefined]);
  });

  it("font: full coverage stored with family; missing č/š/ž refused for a Slovenian brand, kept with the gap for an English one", async () => {
    const r = await uploadBrandFile(db, s3, A, brandA, "font", { filename: "TinySans.ttf", bytes: realFont("TinySans") });
    const [row] = await db.select().from(brandAssets).where(eq(brandAssets.id, r.id));
    expect(row.meta).toEqual({ family: "Tiny Sans", missingGlyphs: [] });
    await expect(uploadBrandFile(db, s3, A, brandA, "font", { filename: "NoDiacritics.ttf", bytes: font("abc") }))
      .rejects.toMatchObject({ code: "MISSING_GLYPHS", detail: "č š ž ć đ Č Š Ž Ć Đ" });
    const en = await uploadBrandFile(db, s3, B, brandB, "font", { filename: "TinyPlain.ttf", bytes: realFont("TinyPlain") });
    const [enRow] = await db.select().from(brandAssets).where(eq(brandAssets.id, en.id));
    expect(enRow.meta.missingGlyphs).toHaveLength(10);
  });

  it("font: a variable font is stored as its static default instance; a font the renderer cannot draw is refused", async () => {
    const { isVariableFont } = await import("../files/font");
    const { fontRenderError } = await import("../design/font-check");
    const variable = realFont("TinySansVar");
    expect(isVariableFont(variable)).toBe(true);
    expect(await fontRenderError(variable)).not.toBeNull(); // incident 2026-10-10: Satori cannot read variable fonts
    const r = await uploadBrandFile(db, s3, A, brandA, "font", { filename: "TinySans[wght].ttf", bytes: variable });
    const [row] = await db.select().from(brandAssets).where(eq(brandAssets.id, r.id));
    expect(row.meta).toEqual({ family: "Tiny Sans Var", missingGlyphs: [], variable: true });
    const stored = new Uint8Array(await (await fetch(await brandFileUrl(db, s3, A, "asset", r.id))).arrayBuffer());
    expect(isVariableFont(stored)).toBe(false);
    expect(await fontRenderError(stored)).toBeNull();

    const before = await sql`select count(*)::int n from brand_assets`;
    await expect(uploadBrandFile(db, s3, B, brandB, "font", { filename: "NoOutlines.ttf", bytes: font() })).rejects.toMatchObject({ code: "FONT_UNSUPPORTED" });
    expect(await sql`select count(*)::int n from brand_assets`).toEqual(before);
  });

  it("wrong type for the slot, garbage and empty files are refused and nothing is stored", async () => {
    const before = await sql`select count(*)::int n from brand_sources`;
    await expect(uploadBrandFile(db, s3, A, brandA, "logo", { filename: "logo.png", bytes: pdf() })).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
    await expect(uploadBrandFile(db, s3, A, brandA, "font", { filename: "x.ttf", bytes: await image("png") })).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
    await expect(uploadBrandFile(db, s3, A, brandA, "source", { filename: "x.exe", bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0, 1]) })).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
    await expect(uploadBrandFile(db, s3, A, brandA, "source", { filename: "a.zip", bytes: makeZip(["a.txt"]) })).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
    await expect(uploadBrandFile(db, s3, A, brandA, "source", { filename: "x.png", bytes: (await image("png")).subarray(0, 50) })).rejects.toMatchObject({ code: "INVALID_FILE" });
    await expect(uploadBrandFile(db, s3, A, brandA, "font", { filename: "x.ttf", bytes: font().subarray(0, 30) })).rejects.toMatchObject({ code: "INVALID_FILE" });
    await expect(uploadBrandFile(db, s3, A, brandA, "source", { filename: "e.txt", bytes: new Uint8Array() })).rejects.toMatchObject({ code: "EMPTY" });
    expect(await sql`select count(*)::int n from brand_sources`).toEqual(before);
  });

  it("size boundary: exactly the limit passes the size check, one byte more is TOO_LARGE", async () => {
    const at = new Uint8Array(MAX_BYTES.source).fill(0x61); // valid text
    await expect(uploadBrandFile(db, s3, A, brandA, "source", { filename: "big.txt", bytes: at })).resolves.toMatchObject({ kind: "text" });
    const over = new Uint8Array(MAX_BYTES.source + 1).fill(0x61);
    await expect(uploadBrandFile(db, s3, A, brandA, "source", { filename: "big2.txt", bytes: over })).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("same file twice in a brand is a duplicate; the same file in another brand is fine", async () => {
    const bytes = pdf("dup");
    await uploadBrandFile(db, s3, A, brandA, "source", { filename: "a.pdf", bytes });
    await expect(uploadBrandFile(db, s3, A, brandA, "source", { filename: "b.pdf", bytes })).rejects.toMatchObject({ code: "DUPLICATE" });
    const other = (await createBrand(db, A, { name: "Drugi", slug: "drugi", languages: ["sl"] })).id;
    await expect(uploadBrandFile(db, s3, A, other, "source", { filename: "a.pdf", bytes })).resolves.toBeDefined();
  });

  it("count limit per slot: the last allowed upload passes, the next is LIMIT_REACHED", async () => {
    for (let i = 0; i < MAX_FILES.logo; i++) await uploadBrandFile(db, s3, A, brandA, "logo", { filename: `l${i}.png`, bytes: await image("png", 10 + i, 10) });
    await expect(uploadBrandFile(db, s3, A, brandA, "logo", { filename: "one-more.png", bytes: await image("png", 99, 10) })).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    // fonts have their own limit
    await expect(uploadBrandFile(db, s3, A, brandA, "font", { filename: "f.ttf", bytes: realFont("TinySans") })).resolves.toBeDefined();
  });

  it("archived brands take no uploads; editors read and download but cannot upload or delete", async () => {
    const r = await uploadBrandFile(db, s3, A, brandA, "source", { filename: "a.pdf", bytes: pdf("ed") });
    await expect(uploadBrandFile(db, s3, editorA, brandA, "source", { filename: "b.pdf", bytes: pdf("ed2") })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteBrandFile(db, s3, editorA, "source", r.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await listBrandFiles(db, editorA, brandA)).sources.map((s) => s.id)).toEqual([r.id]);
    expect((await fetchBytes(await brandFileUrl(db, s3, editorA, "source", r.id))).status).toBe(200);
    await setBrandArchived(db, A, brandA, true);
    await expect(uploadBrandFile(db, s3, A, brandA, "source", { filename: "c.pdf", bytes: pdf("arch") })).rejects.toMatchObject({ code: "ARCHIVED" });
  });

  it("delete removes the row and the object; the old URL stops working", async () => {
    const r = await uploadBrandFile(db, s3, A, brandA, "source", { filename: "a.pdf", bytes: pdf("del") });
    const [row] = await db.select().from(brandSources).where(eq(brandSources.id, r.id));
    const u = await brandFileUrl(db, s3, A, "source", r.id);
    await deleteBrandFile(db, s3, A, "source", r.id);
    expect(await db.select().from(brandSources).where(eq(brandSources.id, r.id))).toEqual([]);
    expect(await s3.exists(row.storageKey)).toBe(false);
    expect((await fetchBytes(u)).status).toBeGreaterThanOrEqual(400); // 404, or 403 where the key lacks ListBucket
    await expect(brandFileUrl(db, s3, A, "source", r.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("failure handling", () => {
  it("S3 put fails → no row", async () => {
    const broken: Storage = { ...s3, put: async () => { throw new Error("S3 down"); } };
    await expect(uploadBrandFile(db, broken, A, brandA, "source", { filename: "a.pdf", bytes: pdf("s3down") })).rejects.toThrow("S3 down");
    expect((await sql`select count(*)::int n from brand_sources`)[0].n).toBe(0);
  });

  it("row insert fails after the put → the object is removed again (no orphan)", async () => {
    const keys: string[] = [];
    const spy: Storage = { ...s3, put: async (k, b, t) => { keys.push(k); await s3.put(k, b, t); } };
    await sql`alter table brand_sources add constraint tmp_block check (filename <> 'block.pdf')`;
    try {
      await expect(uploadBrandFile(db, spy, A, brandA, "source", { filename: "block.pdf", bytes: pdf("orphan") })).rejects.toThrow();
    } finally {
      await sql`alter table brand_sources drop constraint tmp_block`;
    }
    expect(keys).toHaveLength(1);
    expect(await s3.exists(keys[0])).toBe(false);
  });

  it("presigned URLs: default 5 min, max 15 min, longer refused", async () => {
    const r = await uploadBrandFile(db, s3, A, brandA, "source", { filename: "a.pdf", bytes: pdf("ttl") });
    const u = new URL(await brandFileUrl(db, s3, A, "source", r.id));
    expect(u.searchParams.get("X-Amz-Expires")).toBe("300");
    const [row] = await db.select().from(brandSources).where(eq(brandSources.id, r.id));
    const opts = { filename: "a.pdf", contentType: "application/pdf", inline: false };
    expect(new URL(await s3.presignGet(row.storageKey, { ...opts, expiresIn: 900 })).searchParams.get("X-Amz-Expires")).toBe("900");
    await expect(s3.presignGet(row.storageKey, { ...opts, expiresIn: 901 })).rejects.toThrow("PRESIGN_TOO_LONG");
  });
});

describe("tenant separation (owner requirement)", () => {
  it("org B cannot list, get a URL for, or delete org A's files — A's row and object stay", async () => {
    const src = await uploadBrandFile(db, s3, A, brandA, "source", { filename: "tajno.pdf", bytes: pdf("secret") });
    const logo = await uploadBrandFile(db, s3, A, brandA, "logo", { filename: "logo.png", bytes: await image("png") });
    const [row] = await db.select().from(brandSources).where(eq(brandSources.id, src.id));

    await expect(listBrandFiles(db, B, brandA)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(brandFileUrl(db, s3, B, "source", src.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(brandFileUrl(db, s3, B, "asset", logo.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteBrandFile(db, s3, B, "source", src.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteBrandFile(db, s3, B, "asset", logo.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(uploadBrandFile(db, s3, B, brandA, "source", { filename: "x.pdf", bytes: pdf("into-a") })).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(await db.select().from(brandSources).where(eq(brandSources.id, src.id))).toHaveLength(1);
    expect(await s3.exists(row.storageKey)).toBe(true);
    expect((await listBrandFiles(db, A, brandA)).sources).toHaveLength(1);
    expect((await sql`select count(*)::int n from brand_sources where org_id = ${B.orgId}`)[0].n).toBe(0);
  });

  it("keys of different orgs never share a prefix, even for identical files", async () => {
    const bytes = pdf("same");
    const a = await uploadBrandFile(db, s3, A, brandA, "source", { filename: "x.pdf", bytes });
    const b = await uploadBrandFile(db, s3, B, brandB, "source", { filename: "x.pdf", bytes });
    const rows = await db.select().from(brandSources);
    const key = (id: string) => rows.find((r) => r.id === id)!.storageKey;
    expect(key(a.id).startsWith(`org/${A.orgId}/`)).toBe(true);
    expect(key(b.id).startsWith(`org/${B.orgId}/`)).toBe(true);
  });
});

describe("cross-tenant harness", () => {
  const scopes = () => ({ a: forOrg(db, A), b: forOrg(db, B) });
  crossTenantSuite({
    name: "brand_sources",
    scopes,
    seedInA: async (a) => {
      const id = crypto.randomUUID();
      await a.insert(brandSources, { id, brandId: brandA, filename: "f.pdf", storageKey: `org/${A.orgId}/brand/${brandA}/pdf/${id}.pdf`, contentType: "application/pdf", sizeBytes: 1, sha256: id, kind: "pdf", createdBy: A.userId });
      return id;
    },
    read: (s, id) => s.select(brandSources, eq(brandSources.id, id)),
    update: (s, id) => s.update(brandSources, { filename: "hacked.pdf" }, eq(brandSources.id, id)),
    remove: (s, id) => s.delete(brandSources, eq(brandSources.id, id)),
    raw: async (id) => (await db.select().from(brandSources).where(eq(brandSources.id, id)))[0],
  });
  crossTenantSuite({
    name: "brand_assets",
    scopes,
    seedInA: async (a) => {
      const id = crypto.randomUUID();
      await a.insert(brandAssets, { id, brandId: brandA, filename: "l.png", storageKey: `org/${A.orgId}/brand/${brandA}/logo/${id}.png`, contentType: "image/png", sizeBytes: 1, sha256: id, kind: "logo", createdBy: A.userId });
      return id;
    },
    read: (s, id) => s.select(brandAssets, eq(brandAssets.id, id)),
    update: (s, id) => s.update(brandAssets, { filename: "hacked.png" }, eq(brandAssets.id, id)),
    remove: (s, id) => s.delete(brandAssets, eq(brandAssets.id, id)),
    raw: async (id) => (await db.select().from(brandAssets).where(eq(brandAssets.id, id)))[0],
  });
});

describe("cleanFilename", () => {
  it("strips paths, control and bidi characters; never empty; ≤ 200 chars", () => {
    expect(cleanFilename("C:\\Users\\x\\Cenik.pdf")).toBe("Cenik.pdf");
    expect(cleanFilename("a\u202egnp.exe")).toBe("agnp.exe");
    expect(cleanFilename("\u0000\u0001")).toBe("file");
    expect(cleanFilename("č".repeat(300))).toHaveLength(200);
  });
});

describe("uploadAuto: drop anything, incl. a ZIP", () => {
  it("one ZIP is unpacked and every entry is checked and filed on its own", async () => {
    const { makeZipEntries } = await import("../../../tests/fixtures/files");
    const { compress } = await import("wawoff2");
    const fs = await import("node:fs");
    const { uploadAuto } = await import("./files");
    const tiny = new Uint8Array(fs.readFileSync("tests/fixtures/fonts/TinySans.ttf"));
    const zip = makeZipEntries([
      { name: "Brand/", bytes: new Uint8Array() },
      { name: "Brand/Logo.png", bytes: await image("png", 120, 40) },
      { name: "Brand/fonts/TinySans.woff2", bytes: await compress(tiny) },
      { name: "Brand/brief.pdf", bytes: pdf("zip-brief"), deflate: true },
      { name: "Brand/team.jpg", bytes: await image("jpeg") },
      { name: "Brand/icon.svg", bytes: new TextEncoder().encode("<svg onload='x'/>") },
      { name: "Brand/old.zip", bytes: makeZipEntries([{ name: "x.txt", bytes: new TextEncoder().encode("x") }]) },
      { name: "__MACOSX/Brand/._Logo.png", bytes: new TextEncoder().encode("junk") },
    ]);
    const res = await uploadAuto(db, s3, A, brandA, { filename: "brand.zip", bytes: zip });
    expect(res.map((r) => [r.name, r.ok ? r.slot : r.error])).toEqual([
      ["Brand/Logo.png", "logo"],
      ["Brand/fonts/TinySans.woff2", "font"],
      ["Brand/brief.pdf", "source"],
      ["Brand/team.jpg", "source"],
      ["Brand/icon.svg", "UNSUPPORTED_TYPE"],
      ["Brand/old.zip", "UNSUPPORTED_TYPE"],
    ]);
    const files = await listBrandFiles(db, A, brandA);
    expect(files.logos.map((l) => l.filename)).toEqual(["Logo.png"]);
    expect(files.fonts[0]).toMatchObject({ filename: "TinySans.woff2", contentType: "font/ttf", meta: { family: "Tiny Sans", missingGlyphs: [], convertedFrom: "woff2" } });
    expect(files.fonts[0].storageKey).toMatch(/\/font\/[0-9a-f-]{36}\.ttf$/);
    expect(files.sources.map((s) => s.kind).sort()).toEqual(["image", "pdf"]);
    // the stored font is a plain TTF the renderer can read
    const got = await fetch(await brandFileUrl(db, s3, A, "asset", files.fonts[0].id));
    expect(new Uint8Array(await got.arrayBuffer()).subarray(0, 4)).toEqual(new Uint8Array([0, 1, 0, 0]));
  });

  it("a single file still goes to its slot; a forced slot wins; brand errors throw, file errors are results", async () => {
    const { uploadAuto } = await import("./files");
    expect(await uploadAuto(db, s3, A, brandA, { filename: "x.pdf", bytes: pdf("auto1") })).toMatchObject([{ ok: true, slot: "source", kind: "pdf" }]);
    expect(await uploadAuto(db, s3, A, brandA, { filename: "photo.png", bytes: await image("png", 31, 31) }, "logo")).toMatchObject([{ ok: true, slot: "logo" }]);
    expect(await uploadAuto(db, s3, A, brandA, { filename: "x.svg", bytes: new TextEncoder().encode("<svg/>") })).toMatchObject([{ ok: false, error: "UNSUPPORTED_TYPE", detail: "svg" }]);
    await expect(uploadAuto(db, s3, editorA, brandA, { filename: "x.pdf", bytes: pdf("ed") })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(uploadAuto(db, s3, B, brandA, { filename: "x.pdf", bytes: pdf("b") })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a broken ZIP is one clear error; nothing stored", async () => {
    const { uploadAuto } = await import("./files");
    const broken = makeZip(["a.txt"]);
    broken[broken.length - 22 + 16] = 0xff;
    expect(sniff(broken)).toBe("unknown"); // unreadable directory: not even recognised as a ZIP
    expect(await uploadAuto(db, s3, A, brandA, { filename: "b.zip", bytes: broken })).toMatchObject([{ ok: false, error: "UNSUPPORTED_TYPE" }]);
    expect((await sql`select count(*)::int n from brand_sources`)[0].n).toBe(0);
  });

  it("WOFF fonts without č/š/ž: refused for a Slovenian brand, accepted (gap recorded) for an English one", async () => {
    const { makeWoff } = await import("../../../tests/fixtures/files");
    const { uploadAuto } = await import("./files");
    const woff = makeWoff(realFont("TinyPlain"));
    expect(await uploadAuto(db, s3, A, brandA, { filename: "Plain.woff", bytes: woff })).toMatchObject([{ ok: false, error: "MISSING_GLYPHS" }]);
    expect(await uploadAuto(db, s3, B, brandB, { filename: "Plain.woff", bytes: woff })).toMatchObject([{ ok: true, slot: "font" }]);
  });
});
