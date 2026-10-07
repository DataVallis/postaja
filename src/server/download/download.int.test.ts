// One-click download (TASK-016): a post's ZIP and a day's ZIP — contents, order, overview, access, tenancy.
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { addChannel, createBrand, getBrandDetail, saveProfile } from "../brands/service";
import { posts, postMedia } from "../db/schema";
import { createS3Storage, s3ConfigFromEnv } from "../files/storage";
import { unzip } from "../files/zip";
import { createOrganization } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { handleDayZip, handlePostZip } from "./http";
import { getDocumentProxy } from "unpdf";
import sharp from "sharp";
import { handlePostPdf } from "./http";
import { dayArchive, postArchive, postPdf } from "./service";
import { zipBytes } from "../files/zip-writer";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const storage = createS3Storage(s3ConfigFromEnv());
const profile = { cgp: "CGP", rules: { bannedWords: [], ctaPhrases: [], regexMust: [], regexMustNot: [] }, pillars: [], visual: { colors: {}, imageStyle: "", negativePrompt: "" } };
const chan = (platform: "instagram" | "linkedin", handle: string) => ({ platform, handle, language: "sl" as const, goal: { postsPerDay: 1, weekdays: [1] }, allowedTypes: ["text" as const] });
const dec = new TextDecoder();

let A: OrgContext, B: OrgContext, aib: string, dt: string, igA: string, liA: string, igB: string, brandB: string;
beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, channels, posts, post_media cascade`;
  const s = (await session((await signIn("boss@datavallis.com"))!))!;
  const actor = { userId: s.user.id, role: "superadmin" as const };
  const d = { mailer, baseURL: "http://localhost:3000" };
  const a = await createOrganization(db, d, actor, { name: "Org A", slug: "org-a", plan: "pro", ownerEmail: "boss@datavallis.com" });
  const b = await createOrganization(db, d, actor, { name: "Org B", slug: "org-b", plan: "pro", ownerEmail: "b@b.si" });
  const bUser = (await session((await signIn("b@b.si"))!))!.user;
  A = { userId: s.user.id, orgId: a.orgId, orgName: "Org A", role: "owner", plan: "pro" };
  B = { userId: bUser.id, orgId: b.orgId, orgName: "Org B", role: "owner", plan: "pro" };
  aib = (await createBrand(db, A, { name: "aibuilders.si", slug: "aibuilders-si", languages: ["sl"] })).id;
  dt = (await createBrand(db, A, { name: "davidtacer.com", slug: "davidtacer-com", languages: ["sl"] })).id;
  brandB = (await createBrand(db, B, { name: "Drugi", slug: "drugi", languages: ["sl"] })).id;
  for (const [c, id] of [[A, aib], [A, dt], [B, brandB]] as const) await saveProfile(db, c, id, { ...profile, note: "t" });
  igA = (await addChannel(db, A, aib, chan("instagram", "@aibuilders"))).id;
  liA = (await addChannel(db, A, dt, chan("linkedin", "davidtacer"))).id;
  igB = (await addChannel(db, B, brandB, chan("instagram", "@drugi"))).id;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

async function post(ctx: OrgContext, brandId: string, channelId: string, x: Partial<typeof posts.$inferInsert>) {
  const { brand } = await getBrandDetail(db, ctx, brandId);
  const id = crypto.randomUUID();
  await forOrg(db, ctx).insert(posts, { id, brandId, channelId, profileVersionId: brand.currentProfileVersionId!, brief: "Brief", status: "ready", format: "image", scheduledOn: "2026-10-07", createdBy: ctx.userId, ...x });
  return id;
}
async function image(ctx: OrgContext, postId: string, position: number, byte: number) {
  const key = `org/${ctx.orgId}/posts/${postId}/${crypto.randomUUID()}.png`;
  await storage.put(key, new Uint8Array([byte, byte, byte]), "image/png");
  await forOrg(db, ctx).insert(postMedia, { id: crypto.randomUUID(), postId, kind: "slide", position, storageKey: key, contentType: "image/png", width: 1080, height: 1350, sizeBytes: 3 });
}
const read = async (a: { entries: Parameters<typeof zipBytes>[0] }) => {
  const z = unzip(await zipBytes(a.entries));
  return Object.fromEntries(z.map((e) => [e.name, (e as { bytes: Uint8Array }).bytes]));
};

describe("post ZIP", () => {
  it("has the text as posted, the first comment and the images in order", async () => {
    const id = await post(A, aib, igA, { content: { caption: "Osem korakov. Čas je.\n\n#ai #gradnja", hashtags: ["#ai", "#gradnja"] }, plan: { topic: "Metoda", firstComment: "Link: aibuilders.si" }, scheduledTime: "08:30" });
    await image(A, id, 1, 2);
    await image(A, id, 0, 1);
    const a = await postArchive(db, storage, A, id);
    expect(a.filename).toBe("aibuilders-si-2026-10-07-instagram-08-30-metoda.zip");
    const files = await read(a);
    expect(Object.keys(files)).toEqual(["besedilo.txt", "prvi-komentar.txt", "1.png", "2.png"]);
    expect(dec.decode(files["besedilo.txt"])).toBe("Osem korakov. Čas je.\n\n#ai #gradnja\n");
    expect([...files["1.png"]]).toEqual([1, 1, 1]);
    await expect(postArchive(db, storage, B, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a thread's parts are separated; a post with nothing to download says so", async () => {
    const id = await post(A, dt, liA, { content: { caption: "a\n\nb", parts: ["Prvi del", "Drugi del"], hashtags: [] } });
    expect(dec.decode((await read(await postArchive(db, storage, A, id)))["besedilo.txt"])).toBe("Prvi del\n\n---\n\nDrugi del\n");
    const empty = await post(A, aib, igA, { status: "planned" });
    await expect(postArchive(db, storage, A, empty)).rejects.toMatchObject({ code: "EMPTY" });
  });
});

describe("LinkedIn carousel as PDF (TASK-018)", () => {
  async function realImage(ctx: OrgContext, postId: string, position: number, bg: string) {
    const key = `org/${ctx.orgId}/posts/${postId}/${crypto.randomUUID()}.png`;
    const png = new Uint8Array(await sharp({ create: { width: 1080, height: 1350, channels: 4, background: bg } }).png().toBuffer());
    await storage.put(key, png, "image/png");
    await forOrg(db, ctx).insert(postMedia, { id: crypto.randomUUID(), postId, kind: "slide", position, storageKey: key, contentType: "image/png", width: 1080, height: 1350, sizeBytes: png.length });
  }

  it("a LinkedIn post with several images gets karusel.pdf in its ZIP; one page per image, in order", async () => {
    const id = await post(A, dt, liA, { format: "carousel", content: { caption: "Karusel", hashtags: [] }, plan: { topic: "Pet korakov" } });
    await realImage(A, id, 1, "#00ff00");
    await realImage(A, id, 0, "#ff000080"); // transparency → white behind it
    const files = await read(await postArchive(db, storage, A, id));
    expect(Object.keys(files)).toEqual(["besedilo.txt", "1.png", "2.png", "karusel.pdf"]);
    const doc = await getDocumentProxy(files["karusel.pdf"]);
    expect(doc.numPages).toBe(2);
    expect((await doc.getMetadata()).info).toMatchObject({ Title: "Pet korakov" });
    const v = (await doc.getPage(1)).getViewport({ scale: 1 });
    expect([v.width, v.height]).toEqual([1080, 1350]);
    // The same PDF on its own, for this org only.
    const pdf = await postPdf(db, storage, A, id);
    expect(pdf.filename).toBe("davidtacer-com-2026-10-07-linkedin-brez-ure-pet-korakov.pdf");
    await expect(postPdf(db, storage, B, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const res = await handlePostPdf(id, { db, storage, getCtx: async () => A });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect((await handlePostPdf(id, { db, storage, getCtx: async () => B })).status).toBe(404);
    expect((await handlePostPdf(id, { db, storage, getCtx: async () => null })).status).toBe(401);
  });

  it("Instagram carousels and single LinkedIn images get no PDF in the ZIP; a post without images has no PDF", async () => {
    const ig = await post(A, aib, igA, { content: { caption: "IG", hashtags: [] } });
    await image(A, ig, 0, 1);
    await image(A, ig, 1, 2);
    expect(Object.keys(await read(await postArchive(db, storage, A, ig)))).not.toContain("karusel.pdf");
    const one = await post(A, dt, liA, { content: { caption: "Ena", hashtags: [] } });
    await realImage(A, one, 0, "#000000");
    expect(Object.keys(await read(await postArchive(db, storage, A, one)))).not.toContain("karusel.pdf");
    const none = await post(A, dt, liA, { content: { caption: "Brez", hashtags: [] } });
    await expect(postPdf(db, storage, A, none)).rejects.toMatchObject({ code: "EMPTY" });
  });
});

describe("day ZIP", () => {
  it("all brands of the day in folders, time order, an overview for Excel; skipped and other days and orgs left out", async () => {
    const p1 = await post(A, aib, igA, { content: { caption: "Zjutraj", hashtags: [] }, plan: { topic: "Jutro" }, scheduledTime: "09:00" });
    await image(A, p1, 0, 9);
    await post(A, aib, igA, { content: { caption: "Zvečer", hashtags: [] }, plan: { topic: "Jutro" }, scheduledTime: "18:00" });
    await post(A, dt, liA, { content: { caption: "LinkedIn", hashtags: [] }, plan: { topic: "Metoda" }, scheduledTime: "08:30" });
    await post(A, aib, igA, { content: { caption: "Preskočena", hashtags: [] }, status: "skipped" });
    await post(A, aib, igA, { content: { caption: "Jutri", hashtags: [] }, scheduledOn: "2026-10-08" });
    await post(B, brandB, igB, { content: { caption: "Tuja", hashtags: [] } });
    const a = await dayArchive(db, storage, A, "2026-10-07");
    expect(a.filename).toBe("postaja-2026-10-07.zip");
    const files = await read(a);
    expect(Object.keys(files)).toEqual([
      "pregled.csv",
      "aibuilders-si/instagram-09-00-jutro/besedilo.txt",
      "aibuilders-si/instagram-09-00-jutro/1.png",
      "aibuilders-si/instagram-18-00-jutro/besedilo.txt",
      "davidtacer-com/linkedin-08-30-metoda/besedilo.txt",
    ]);
    const csv = dec.decode(files["pregled.csv"]);
    expect([...files["pregled.csv"].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM: Excel reads UTF-8
    expect(csv.startsWith("\"Dan\";\"Ura\";\"Brand\"")).toBe(true);
    expect(csv.trim().split("\r\n")).toHaveLength(4);
    expect(csv).toContain('"aibuilders.si";"instagram";"@aibuilders"');

    const one = await dayArchive(db, storage, A, "2026-10-07", dt);
    expect(one.filename).toBe("postaja-2026-10-07-davidtacer-com.zip");
    expect(Object.keys(await read(one))).toEqual(["pregled.csv", "davidtacer-com/linkedin-08-30-metoda/besedilo.txt"]);
    await expect(dayArchive(db, storage, A, "2026-10-07", brandB)).rejects.toMatchObject({ code: "EMPTY" });
    await expect(dayArchive(db, storage, A, "2026-02-30")).rejects.toMatchObject({ code: "INVALID" });
  });

  it("HTTP: members get a ZIP stream; others 401/404", async () => {
    const id = await post(A, aib, igA, { content: { caption: "Zdravo", hashtags: [] }, scheduledTime: "10:00" });
    const deps = (ctx: OrgContext | null) => ({ db, storage, getCtx: async () => ctx });
    const res = await handleDayZip(new Request("http://x/api/plan/download?date=2026-10-07"), deps(A));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain('attachment; filename="postaja-2026-10-07.zip"');
    expect(unzip(new Uint8Array(await res.arrayBuffer())).map((e) => e.name)).toContain("pregled.csv");
    expect((await handlePostZip(id, deps(null))).status).toBe(401);
    expect((await handlePostZip(id, deps(B))).status).toBe(404);
    expect((await handleDayZip(new Request("http://x/?date=nope"), deps(A))).status).toBe(400);
    expect((await handlePostZip(id, deps(A))).status).toBe(200);
  });
});
