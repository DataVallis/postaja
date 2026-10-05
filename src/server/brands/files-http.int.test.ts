import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { image, pdf } from "../../../tests/fixtures/files";
import { createS3Storage, s3ConfigFromEnv } from "../files/storage";
import { createOrganization } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { MAX_BYTES } from "./files";
import { handleDownload, handleUpload, MULTIPART_OVERHEAD, type HttpDeps } from "./files-http";
import { createBrand } from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const storage = createS3Storage(s3ConfigFromEnv());
const ORIGIN = "https://dev-postaja.example.test";

let A: OrgContext;
let B: OrgContext;
let brandA: string;
let as: OrgContext | null;
const deps = (): HttpDeps => ({ db, storage, appOrigin: ORIGIN, getCtx: async () => as });

/** A browser-like multipart POST; Content-Length = real body size unless overridden. */
async function post(brandId: string, slot: string, file: Uint8Array | null, opts: { origin?: string | null; length?: string | null; name?: string } = {}) {
  const fd = new FormData();
  if (file) fd.append("file", new Blob([new Uint8Array(file)]), opts.name ?? "f.bin");
  const encoded = new Response(fd); // one encoding: body and boundary must match
  const ct = encoded.headers.get("content-type")!;
  const body = new Uint8Array(await encoded.arrayBuffer());
  const headers: Record<string, string> = { "content-type": ct };
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin) headers.origin = origin;
  const length = opts.length === undefined ? String(body.length) : opts.length;
  if (length !== null) headers["content-length"] = length;
  return handleUpload(new Request(`${ORIGIN}/api/brands/${brandId}/files?slot=${slot}`, { method: "POST", body, headers }), brandId, deps());
}

beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, channels, brand_sources, brand_assets cascade`;
  const s = (await session((await signIn("boss@datavallis.com"))!))!;
  const actor = { userId: s.user.id, role: "superadmin" as const };
  const a = await createOrganization(db, { mailer, baseURL: "http://localhost:3000" }, actor, { name: "Org A", slug: "org-a", plan: "pro", ownerEmail: "boss@datavallis.com" });
  const b = await createOrganization(db, { mailer, baseURL: "http://localhost:3000" }, actor, { name: "Org B", slug: "org-b", plan: "pro", ownerEmail: "b@b.si" });
  const bUser = (await session((await signIn("b@b.si"))!))!.user;
  A = { userId: s.user.id, orgId: a.orgId, orgName: "A", role: "owner", plan: "pro" };
  B = { userId: bUser.id, orgId: b.orgId, orgName: "B", role: "owner", plan: "pro" };
  brandA = (await createBrand(db, A, { name: "Inženirji", slug: "inzenirji", languages: ["sl"] })).id;
  as = A;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

describe("POST /api/brands/<id>/files", () => {
  it("owner uploads a PDF source → 201 with id; download redirects to a 5-minute presigned URL that serves the bytes", async () => {
    const bytes = pdf("http");
    const res = await post(brandA, "source", bytes, { name: "cenik.pdf" });
    expect(res.status).toBe(201);
    const { id, table } = (await res.json()) as { id: string; table: "source" };
    const dl = await handleDownload(table, id, deps());
    expect(dl.status).toBe(302);
    expect(dl.headers.get("cache-control")).toBe("no-store");
    const loc = dl.headers.get("location")!;
    expect(new URL(loc).searchParams.get("X-Amz-Expires")).toBe("300");
    expect(new Uint8Array(await (await fetch(loc)).arrayBuffer())).toEqual(bytes);
  });

  it("cross-site or missing Origin → 403 before anything else; anonymous → 401", async () => {
    expect((await post(brandA, "source", pdf(), { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(brandA, "source", pdf(), { origin: null })).status).toBe(403);
    as = null;
    expect((await post(brandA, "source", pdf())).status).toBe(401);
    expect((await sql`select count(*)::int n from brand_sources`)[0].n).toBe(0);
  });

  it("bad slot 400; missing Content-Length 411; no file field 400", async () => {
    expect((await post(brandA, "avatar", pdf())).status).toBe(400);
    expect((await post(brandA, "source", pdf(), { length: null })).status).toBe(411);
    expect((await post(brandA, "source", null)).status).toBe(400);
  });

  it("size is refused from the header before the body is read: limit + overhead + 1 → 413, real small body → 201", async () => {
    const gate = MAX_BYTES.logo + MULTIPART_OVERHEAD;
    // Claimed length one byte over the gate → 413 without parsing (the body itself is tiny and valid).
    expect((await post(brandA, "logo", await image("png"), { length: String(gate + 1) })).status).toBe(413);
    expect((await post(brandA, "logo", await image("png"))).status).toBe(201);
  });

  it("service errors map to statuses: wrong type 415, broken font 422, duplicate 409, other org's brand 404", async () => {
    expect((await post(brandA, "logo", pdf(), { name: "logo.png" })).status).toBe(415);
    expect((await post(brandA, "font", new Uint8Array([0, 1, 0, 0, 0, 9]), { name: "x.ttf" })).status).toBe(422);
    const bytes = pdf("dup");
    expect((await post(brandA, "source", bytes)).status).toBe(201);
    const dup = await post(brandA, "source", bytes);
    expect([dup.status, ((await dup.json()) as { error: string }).error]).toEqual([409, "DUPLICATE"]);
    as = B;
    expect((await post(brandA, "source", pdf("b"))).status).toBe(404);
  });
});

describe("GET /api/brand-files/<table>/<id>", () => {
  it("another org gets 404 (no URL leaks), anonymous 401, unknown table 404", async () => {
    const { id } = (await (await post(brandA, "source", pdf("leak"))).json()) as { id: string };
    as = B;
    const res = await handleDownload("source", id, deps());
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
    as = null;
    expect((await handleDownload("source", id, deps())).status).toBe(401);
    as = A;
    expect((await handleDownload("users", id, deps())).status).toBe(404);
  });
});
