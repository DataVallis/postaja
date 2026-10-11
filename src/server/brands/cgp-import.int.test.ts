import fs from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { image, makeDocx } from "../../../tests/fixtures/files";
import { createS3Storage, s3ConfigFromEnv } from "../files/storage";
import { createOrganization, inviteMember } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { CGP_MAX_CHARS, cgpTextFromDocument, uploadBrandFile } from "./files";
import { handleCgpImport, type HttpDeps } from "./files-http";
import { createBrand, setBrandArchived } from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const storage = createS3Storage(s3ConfigFromEnv());
const ORIGIN = "https://dev-postaja.example.test";
const enc = (s: string) => new TextEncoder().encode(s);
const cgpPdf = () => new Uint8Array(fs.readFileSync("tests/fixtures/docs/cgp.pdf"));

let A: OrgContext, B: OrgContext, editorA: OrgContext, brandA: string, brandB: string;
let as: OrgContext | null;
const deps = (): HttpDeps => ({ db, storage, appOrigin: ORIGIN, getCtx: async () => as });

async function post(brandId: string, field: { file?: { name: string; bytes: Uint8Array }; sourceId?: string }, origin: string | null = ORIGIN) {
  const fd = new FormData();
  if (field.file) fd.append("file", new Blob([new Uint8Array(field.file.bytes)]), field.file.name);
  if (field.sourceId) fd.append("sourceId", field.sourceId);
  const encoded = new Response(fd);
  const body = new Uint8Array(await encoded.arrayBuffer());
  const headers: Record<string, string> = { "content-type": encoded.headers.get("content-type")!, "content-length": String(body.length) };
  if (origin) headers.origin = origin;
  return handleCgpImport(new Request(`${ORIGIN}/api/brands/${brandId}/cgp-import`, { method: "POST", body, headers }), brandId, deps());
}

beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, channels, brand_sources, brand_assets cascade`;
  const s = (await session((await signIn("boss@datavallis.com"))!))!;
  const actor = { userId: s.user.id, role: "superadmin" as const };
  const d = { mailer, baseURL: "http://localhost:3000" };
  const a = await createOrganization(db, d, actor, { name: "Org A", slug: "org-a", plan: "pro", ownerEmail: "boss@datavallis.com" });
  const b = await createOrganization(db, d, actor, { name: "Org B", slug: "org-b", plan: "pro", ownerEmail: "b@b.si" });
  const bUser = (await session((await signIn("b@b.si"))!))!.user;
  await inviteMember(db, d, actor, a.orgId, { email: "ed@a.si", role: "editor" });
  const ed = (await session((await signIn("ed@a.si"))!))!.user;
  A = { userId: s.user.id, orgId: a.orgId, orgName: "Org A", role: "owner", plan: "pro" };
  B = { userId: bUser.id, orgId: b.orgId, orgName: "Org B", role: "owner", plan: "pro" };
  editorA = { userId: ed.id, orgId: a.orgId, orgName: "Org A", role: "editor", plan: "pro" };
  brandA = (await createBrand(db, A, { name: "Inženirji", slug: "inzenirji", languages: ["sl"] })).id;
  brandB = (await createBrand(db, B, { name: "Cherr", slug: "cherr", languages: ["en"] })).id;
  as = A;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

describe("cgpTextFromDocument", () => {
  it("a Word file from the computer → its text with headings; nothing is saved", async () => {
    const versions = await sql`select count(*)::int n from brand_profile_versions`;
    const r = await cgpTextFromDocument(db, storage, A, brandA, { file: { filename: "CGP.docx", bytes: makeDocx([{ text: "Kdo smo", style: "Heading1" }, { text: "Inženirji za inženirje." }]) } });
    expect(r).toEqual({ text: "# Kdo smo\nInženirji za inženirje.", filename: "CGP.docx", kind: "docx" });
    expect(await sql`select count(*)::int n from brand_profile_versions`).toEqual(versions);
    expect((await sql`select count(*)::int n from brand_sources`)[0].n).toBe(0);
  });

  it("an uploaded PDF source of this brand → its text", async () => {
    const src = await uploadBrandFile(db, storage, A, brandA, "source", { filename: "CGP Inženirji.pdf", bytes: cgpPdf() });
    const r = await cgpTextFromDocument(db, storage, A, brandA, { sourceId: src.id });
    expect(r.filename).toBe("CGP Inženirji.pdf");
    expect(r.text).toContain("Pišemo strokovno, toplo in brez žargona.");
  });

  it("length boundary: exactly 50,000 characters pass, 50,001 are TOO_LONG with the count", async () => {
    expect((await cgpTextFromDocument(db, storage, A, brandA, { file: { filename: "a.txt", bytes: enc("a".repeat(CGP_MAX_CHARS)) } })).text).toHaveLength(CGP_MAX_CHARS);
    await expect(cgpTextFromDocument(db, storage, A, brandA, { file: { filename: "b.txt", bytes: enc("a".repeat(CGP_MAX_CHARS + 1)) } })).rejects.toMatchObject({ code: "TOO_LONG", detail: "50001" });
  });

  it("owner only; another org's brand or source, or another brand's source, is NOT_FOUND; archived refused; images refused", async () => {
    const file = { file: { filename: "a.txt", bytes: enc("CGP") } };
    await expect(cgpTextFromDocument(db, storage, editorA, brandA, file)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(cgpTextFromDocument(db, storage, B, brandA, file)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const srcB = await uploadBrandFile(db, storage, B, brandB, "source", { filename: "b.txt", bytes: enc("SECRET-B") });
    await expect(cgpTextFromDocument(db, storage, A, brandA, { sourceId: srcB.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const other = (await createBrand(db, A, { name: "Drugi", slug: "drugi", languages: ["sl"] })).id;
    const srcOther = await uploadBrandFile(db, storage, A, other, "source", { filename: "o.txt", bytes: enc("OTHER") });
    await expect(cgpTextFromDocument(db, storage, A, brandA, { sourceId: srcOther.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(cgpTextFromDocument(db, storage, A, brandA, { file: { filename: "x.png", bytes: await image("png") } })).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
    await setBrandArchived(db, A, brandA, true);
    await expect(cgpTextFromDocument(db, storage, A, brandA, file)).rejects.toMatchObject({ code: "ARCHIVED" });
  });
});

describe("POST /api/brands/<id>/cgp-import", () => {
  it("200 with the text; foreign Origin 403; anonymous 401; no file and no source 400; image 415; editor 403", async () => {
    const ok = await post(brandA, { file: { name: "CGP.md", bytes: enc("# CGP\nTon: topel.") } });
    expect([ok.status, await ok.json()]).toEqual([200, { text: "# CGP\nTon: topel.", filename: "CGP.md", kind: "text" }]);
    expect((await post(brandA, { file: { name: "CGP.md", bytes: enc("x") } }, "https://evil.example")).status).toBe(403);
    expect((await post(brandA, {})).status).toBe(400);
    expect((await post(brandA, { file: { name: "x.png", bytes: await image("png") } })).status).toBe(415);
    as = editorA;
    expect((await post(brandA, { file: { name: "CGP.md", bytes: enc("x") } })).status).toBe(403);
    as = null;
    expect((await post(brandA, { file: { name: "CGP.md", bytes: enc("x") } })).status).toBe(401);
  });
});
