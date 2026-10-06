// Post images (TASK-015) against the real database and S3 stand-in, with a fake image provider: claim and queue,
// render and store, cheap text refresh, cost cap and provider failures, access and tenancy, bulk image steps,
// the template save and the HTTP routes.
import { eq } from "drizzle-orm";
import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { uploadBrandFile } from "../brands/files";
import { addChannel, createBrand, getBrandDetail, saveImageTemplate, saveProfile } from "../brands/service";
import { runBulkItem, startBulk, type JobQueue, type QueueJob } from "../bulk/service";
import { orgSettings, posts } from "../db/schema";
import { createS3Storage, s3ConfigFromEnv } from "../files/storage";
import type { LlmClient } from "../llm/types";
import { createOrganization, inviteMember } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { ImageError, type ImageClient, type ImageRequest } from "./fal";
import { handleMedia, handlePreview } from "./http";
import { listPostMedia, postMediaUrl, requestImages, runImageJob, setImageText, type PostImageJob } from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const storage = createS3Storage(s3ConfigFromEnv());
const profile = { cgp: "CGP", rules: { bannedWords: [], ctaPhrases: [], regexMust: [], regexMustNot: [] }, pillars: [], visual: { colors: { accent: "#e0112b" }, imageStyle: "isometric, navy", negativePrompt: "" } };
const noLlm: LlmClient = { async structured() { throw new Error("no text in these tests"); } };

/** A fake provider: a solid-colour JPEG of the asked size; records the requests; can be told to fail. */
function fakeImages(fail?: ImageError) {
  const calls: ImageRequest[] = [];
  const client: ImageClient = {
    async generate(req) {
      calls.push(req);
      if (fail) throw fail;
      const bytes = new Uint8Array(await sharp({ create: { width: req.width, height: req.height, channels: 3, background: "#ff0000" } }).jpeg().toBuffer());
      return { bytes, contentType: "image/jpeg", width: req.width, height: req.height };
    },
  };
  return { client, calls };
}
function memoryQueue() {
  const jobs: { name: string; data: QueueJob; key: string }[] = [];
  const q: JobQueue = { async send(name, data, key) { jobs.push({ name, data, key }); } };
  return { q, jobs };
}

let A: OrgContext, B: OrgContext, editorA: OrgContext, brandA: string, brandB: string, igA: string, igB: string;
beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, channels, brand_sources, brand_assets, posts, post_media, usage_ledger, plan_imports, bulk_runs, bulk_items cascade`;
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
  brandA = (await createBrand(db, A, { name: "Cherr", slug: "cherr", languages: ["sl"] })).id;
  brandB = (await createBrand(db, B, { name: "Drugi", slug: "drugi", languages: ["sl"] })).id;
  await saveProfile(db, A, brandA, { ...profile, note: "t" });
  await saveProfile(db, B, brandB, { ...profile, note: "t" });
  const chan = { platform: "instagram" as const, language: "sl" as const, goal: { postsPerDay: 1, weekdays: [1] }, allowedTypes: ["single_image" as const] };
  igA = (await addChannel(db, A, brandA, { ...chan, handle: "@cherr" })).id;
  igB = (await addChannel(db, B, brandB, { ...chan, handle: "@drugi" })).id;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

async function post(ctx: OrgContext, brandId: string, channelId: string, extra: Partial<typeof posts.$inferInsert> = {}) {
  const { brand } = await getBrandDetail(db, ctx, brandId);
  const id = crypto.randomUUID();
  await forOrg(db, ctx).insert(posts, {
    id, brandId, channelId, profileVersionId: brand.currentProfileVersionId!, brief: "Brief", status: "planned", format: "image",
    plan: { topic: "Tema", category: "The problem", overlayText: "Daš. Zaklenjeno je.", imagePrompt: "Temna miza" }, scheduledOn: "2026-10-06", createdBy: ctx.userId, ...extra,
  });
  return id;
}
const media = async (id: string) => sql`select kind, position, width, height, storage_key, model from post_media where post_id = ${id} order by kind, position`;
const state = async (id: string) => (await sql`select media_status, media_error from posts where id = ${id}`)[0];
const ledger = async () => sql`select state, megapixels, cost_micro_usd::text as cost, model from usage_ledger`;
const run = async (jobs: { data: QueueJob }[], images: ImageClient | null) => {
  for (const j of jobs) {
    if ("itemId" in j.data) await runBulkItem(db, { llm: noLlm, storage, images }, j.data);
    else await runImageJob(db, { images, storage }, j.data as PostImageJob);
  }
};

describe("one post's images", () => {
  it("queues once, renders the background and the slides, bills whole megapixels", async () => {
    const id = await post(A, brandA, igA);
    const { q, jobs } = memoryQueue();
    await requestImages(db, q, editorA, id, "new");
    expect(jobs).toEqual([{ name: "post-image", data: { postId: id, mode: "new" }, key: `post:${id}:image` }]);
    expect(await state(id)).toEqual({ media_status: "queued", media_error: null });
    await expect(requestImages(db, q, A, id, "new")).rejects.toMatchObject({ code: "BAD_STATE" }); // already working
    await expect(requestImages(db, q, B, id, "new")).rejects.toMatchObject({ code: "NOT_FOUND" }); // other org

    const fal = fakeImages();
    await run(jobs, fal.client);
    expect(fal.calls).toHaveLength(1);
    expect(fal.calls[0].prompt).toContain("Temna miza");
    expect(fal.calls[0].prompt).toContain("Style: isometric, navy");
    expect(fal.calls[0].width * fal.calls[0].height).toBeLessThanOrEqual(1_000_000);
    expect(await state(id)).toEqual({ media_status: "ready", media_error: null });
    const rows = await media(id);
    expect(rows.map((r) => [r.kind, r.position, r.width, r.height])).toEqual([["background", 0, fal.calls[0].width, fal.calls[0].height], ["slide", 0, 1080, 1350]]);
    expect(rows[0].model).toBe("fal-ai/flux-pro/v1.1");
    for (const r of rows) {
      expect(r.storage_key).toMatch(new RegExp(`^org/${A.orgId}/posts/${id}/[0-9a-f-]+\\.(png|jpg)$`));
      expect(await storage.exists(r.storage_key)).toBe(true);
    }
    const png = await storage.get(rows[1].storage_key);
    expect(await sharp(png).metadata()).toMatchObject({ format: "png", width: 1080, height: 1350 });
    expect(await ledger()).toEqual([{ state: "settled", megapixels: 1, cost: "40000", model: "fal-ai/flux-pro/v1.1" }]);
    // A second request is allowed once it is done; running the stale job again does nothing.
    await run(jobs, fal.client);
    expect(fal.calls).toHaveLength(1);
  });

  it("refreshes only the text on the stored background (no provider call) and removes the old slides", async () => {
    const id = await post(A, brandA, igA);
    const fal = fakeImages();
    const { q, jobs } = memoryQueue();
    await requestImages(db, q, A, id, "new");
    await run(jobs, fal.client);
    const before = await media(id);
    await setImageText(db, A, id, "Nov naslov.\nDruga vrstica");
    expect((await sql`select plan->>'overlayText' t from posts where id = ${id}`)[0].t).toBe("Nov naslov.\nDruga vrstica");
    jobs.length = 0;
    await requestImages(db, q, A, id, "text");
    await run(jobs, fal.client);
    expect(fal.calls).toHaveLength(1); // still one
    const after = await media(id);
    expect(after[0].storage_key).toBe(before[0].storage_key); // same background
    expect(after[1].storage_key).not.toBe(before[1].storage_key);
    expect(await storage.exists(before[1].storage_key)).toBe(false);
    expect(await ledger()).toHaveLength(1);
  });

  it("a carousel gets one image per slide; the cover carries the background", async () => {
    const id = await post(A, brandA, igA, { format: "carousel", plan: { category: "Kako", slides: ["Ena.", "Dva.", "Tri."], imagePrompt: "Miza" } });
    const { q, jobs } = memoryQueue();
    await requestImages(db, q, A, id, "new");
    await run(jobs, fakeImages().client);
    expect((await listPostMedia(db, A, id)).map((m) => m.position)).toEqual([0, 1, 2]);
    expect(await listPostMedia(db, B, id)).toEqual([]);
    await expect(setImageText(db, A, id, Array.from({ length: 21 }, (_, i) => `S${i}`).join("\n\n"))).rejects.toMatchObject({ code: "INVALID" });
    await setImageText(db, A, id, "Prva\n\nDruga");
    expect((await sql`select plan->'slides' s from posts where id = ${id}`)[0].s).toEqual(["Prva", "Druga"]);
  });

  it("a brand-colour template never calls the provider or spends", async () => {
    await saveImageTemplate(db, A, brandA, { template: { background: "plain", layout: "center", typeface: "mono" }, colors: {} });
    const id = await post(A, brandA, igA);
    const fal = fakeImages();
    const { q, jobs } = memoryQueue();
    await requestImages(db, q, A, id, "new");
    await run(jobs, fal.client);
    expect(fal.calls).toHaveLength(0);
    expect((await media(id)).map((r) => r.kind)).toEqual(["slide"]);
    expect(await ledger()).toEqual([]);
    // and it works without any provider key
    jobs.length = 0;
    await requestImages(db, q, A, id, "new");
    await run(jobs, null);
    expect(await state(id)).toEqual({ media_status: "ready", media_error: null });
  });

  it("the cap stops the image before any call; a provider error releases the reservation", async () => {
    const id = await post(A, brandA, igA);
    const { q, jobs } = memoryQueue();
    await db.update(orgSettings).set({ spendCapMicroUsd: 39_999n }).where(eq(orgSettings.orgId, A.orgId));
    await requestImages(db, q, A, id, "new");
    const fal = fakeImages();
    await run(jobs, fal.client);
    expect(fal.calls).toHaveLength(0);
    expect(await state(id)).toEqual({ media_status: "failed", media_error: "SPEND_CAP" });
    expect(await ledger()).toEqual([]);

    await db.update(orgSettings).set({ spendCapMicroUsd: 1_000_000n }).where(eq(orgSettings.orgId, A.orgId));
    jobs.length = 0;
    await requestImages(db, q, A, id, "new"); // failed → may ask again
    await run(jobs, fakeImages(new ImageError("IMAGE_BLOCKED")).client);
    expect(await state(id)).toEqual({ media_status: "failed", media_error: "IMAGE_BLOCKED" });
    expect(await ledger()).toEqual([]);
    expect(await media(id)).toHaveLength(0);

    jobs.length = 0;
    await requestImages(db, q, A, id, "new");
    await run(jobs, null); // no key on the server
    expect(await state(id)).toEqual({ media_status: "failed", media_error: "NO_IMAGE_KEY" });
  });

  it("the member who asked lost access → NO_ACCESS, nothing made", async () => {
    const id = await post(A, brandA, igA);
    const { q, jobs } = memoryQueue();
    await requestImages(db, q, editorA, id, "new");
    await sql`delete from member where user_id = ${editorA.userId}`;
    const fal = fakeImages();
    await run(jobs, fal.client);
    expect(fal.calls).toHaveLength(0);
    expect(await state(id)).toEqual({ media_status: "failed", media_error: "NO_ACCESS" });
  });

  it("uses the chosen logo; a logo of another brand cannot be chosen; editors cannot change the template", async () => {
    const logoPng = new Uint8Array(await sharp({ create: { width: 600, height: 200, channels: 4, background: "#00ff00" } }).png().toBuffer());
    const logo = await uploadBrandFile(db, storage, A, brandA, "logo", { filename: "logo.png", bytes: logoPng });
    const foreign = await uploadBrandFile(db, storage, B, brandB, "logo", { filename: "logo.png", bytes: logoPng });
    await expect(saveImageTemplate(db, A, brandA, { template: { logoId: foreign.id }, colors: {} })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(saveImageTemplate(db, editorA, brandA, { template: {}, colors: {} })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const v = await saveImageTemplate(db, A, brandA, { template: { logoId: logo.id, background: "plain", footerText: "Polygon" }, colors: { background: "#000000" } });
    // A later profile save (CGP form) keeps the template.
    const { profile: p } = await getBrandDetail(db, A, brandA);
    await saveProfile(db, A, brandA, { cgp: "Nov CGP", rules: p!.rules, pillars: p!.pillars, visual: { colors: p!.visual.colors, imageStyle: "", negativePrompt: "" } });
    const { profile: p2 } = await getBrandDetail(db, A, brandA);
    expect(p2!.version).toBe(v.version + 1);
    expect(p2!.visual.template).toMatchObject({ logoId: logo.id, background: "plain", footerText: "Polygon" });
    expect(p2!.visual.colors.background).toBe("#000000");

    const id = await post(A, brandA, igA);
    const { q, jobs } = memoryQueue();
    await requestImages(db, q, A, id, "new");
    await run(jobs, null);
    const [slide] = await media(id);
    // The footer's logo is green somewhere in the bottom band.
    const { data, info } = await sharp(await storage.get(slide.storage_key)).extract({ left: 0, top: 1150, width: 1080, height: 200 }).raw().toBuffer({ resolveWithObject: true });
    let green = 0;
    for (let i = 0; i < data.length; i += info.channels) if (data[i] < 40 && data[i + 1] > 200 && data[i + 2] < 40) green++;
    expect(green).toBeGreaterThan(1000);
  });
});

describe("bulk images", () => {
  it("a day's posts get their images once; texts and images can run together", async () => {
    const p1 = await post(A, brandA, igA);
    const p2 = await post(A, brandA, igA, { status: "skipped" }); // skipped: not taken
    const p3 = await post(B, brandB, igB); // other org: not taken
    const { q, jobs } = memoryQueue();
    await startBulk(db, q, editorA, { kind: "day", date: "2026-10-06" }, ["image"]);
    expect(jobs.map((j) => [j.name, j.key])).toEqual([["post-image", `post:${p1}:image`]]);
    const fal = fakeImages();
    await run(jobs, fal.client);
    expect(fal.calls).toHaveLength(1);
    expect(await state(p1)).toEqual({ media_status: "ready", media_error: null });
    expect(await state(p2)).toEqual({ media_status: "none", media_error: null });
    expect(await state(p3)).toEqual({ media_status: "none", media_error: null });
    expect((await sql`select step, status from bulk_items`)).toEqual([{ step: "image", status: "done" }]);
    await expect(startBulk(db, q, A, { kind: "day", date: "2026-10-06" }, ["image"])).rejects.toMatchObject({ code: "NOTHING_TO_DO" });
    // Both steps: the planned post without text gets a text item and (already has images) no image item.
    jobs.length = 0;
    await startBulk(db, q, A, { kind: "day", date: "2026-10-06" }, ["text", "image"]);
    expect(jobs.map((j) => j.name)).toEqual(["post-text"]);
  });

  it("a post someone else is already rendering is skipped by the run", async () => {
    const id = await post(A, brandA, igA);
    const { q, jobs } = memoryQueue();
    await startBulk(db, q, A, { kind: "day", date: "2026-10-06" }, ["image"]);
    await requestImages(db, memoryQueue().q, A, id, "new"); // the post page asked first
    const fal = fakeImages();
    await run(jobs, fal.client);
    expect(fal.calls).toHaveLength(0);
    expect((await sql`select status, error from bulk_items`)[0]).toEqual({ status: "skipped", error: "HAS_IMAGES" });
  });
});

describe("HTTP", () => {
  it("image URLs only for members of the post's org", async () => {
    const id = await post(A, brandA, igA);
    const { q, jobs } = memoryQueue();
    await requestImages(db, q, A, id, "new");
    await run(jobs, fakeImages().client);
    const [m] = await listPostMedia(db, A, id);
    const deps = (ctx: OrgContext | null) => ({ db, storage, getCtx: async () => ctx });
    expect((await handleMedia(new Request(`http://x/api/post-media/${m.id}`), m.id, deps(null))).status).toBe(401);
    expect((await handleMedia(new Request(`http://x/api/post-media/${m.id}`), m.id, deps(B))).status).toBe(404);
    const ok = await handleMedia(new Request(`http://x/api/post-media/${m.id}?download=1`), m.id, deps(editorA));
    expect(ok.status).toBe(302);
    expect(decodeURIComponent(ok.headers.get("location")!)).toContain('attachment; filename="cherr-2026-10-06-1.png"');
    await expect(postMediaUrl(db, storage, B, m.id, false)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("the template preview is a PNG for members, 404 for another org, 400 for nonsense", async () => {
    const deps = (ctx: OrgContext | null) => ({ db, storage, getCtx: async () => ctx });
    const res = await handlePreview(new Request(`http://x/api/brands/${brandA}/image-preview?layout=center&typeface=mono&accent=%2339ff14&text=%C4%8Cas`), brandA, deps(editorA));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(await sharp(new Uint8Array(await res.arrayBuffer())).metadata()).toMatchObject({ width: 540, height: 675 });
    expect((await handlePreview(new Request(`http://x/api/brands/${brandA}/image-preview`), brandA, deps(B))).status).toBe(404);
    expect((await handlePreview(new Request(`http://x/api/brands/${brandA}/image-preview?accent=red`), brandA, deps(A))).status).toBe(400);
    expect((await handlePreview(new Request(`http://x/api/brands/${brandA}/image-preview`), brandA, deps(null))).status).toBe(401);
  });
});
