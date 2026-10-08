// Brand designs and post images made from them (TASK-017) against the real database and S3 stand-in, with fake
// Claude and fal: what Claude sees, validation and retry, versions, cost, the post flow (plan → illustrations with the
// brand's style references → render), free text refresh, access and tenancy, bulk, HTTP.
import { eq } from "drizzle-orm";
import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { cardDesign } from "../../../tests/fixtures/design";
import { deleteBrandFile, uploadBrandFile } from "../brands/files";
import { addChannel, createBrand, getBrandDetail, saveProfile, setBrandTextModel } from "../brands/service";
import { runBulkItem, startBulk, type JobQueue, type QueueJob } from "../bulk/service";
import { orgSettings, posts } from "../db/schema";
import { createS3Storage, s3ConfigFromEnv } from "../files/storage";
import { type ImageClient, type ImageRequest } from "../images/fal";
import { handleDesignPreview, handleMedia } from "../images/http";
import { deleteImageVersion, listImageVersions, listPostMedia, requestImages, restoreImageVersion, runImageJob, setPostPartnerLogo, setSlideTexts, type PostImageJob } from "../images/service";
import { postArchive } from "../download/service";
import { animatablePositions, requestAnimation, runVideoJob, type PostVideoJob } from "../video/service";
import { probeVideo } from "../video/ffmpeg";
import { deletePostVideo, listPostVideos } from "../video/media";
import { LlmError, type LlmClient, type StructuredRequest } from "../llm/types";
import { createOrganization, inviteMember } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { createPersonaManual, setPersonaInPosts, uploadPassportImage } from "../personas/service";
import { estimateBulk } from "../bulk/estimate";
import { activateDesign, brandAssetBytes, currentDesign, listDesigns, listPartnerLogos, requestDesign, runDesignJob, type DesignJob } from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const storage = createS3Storage(s3ConfigFromEnv());
const profile = { cgp: "Ton: jasen, brez pretiravanja.", rules: { bannedWords: [], ctaPhrases: [], regexMust: [], regexMustNot: [] }, pillars: [], visual: { colors: { accent: "#e0112b" }, imageStyle: "", negativePrompt: "" } };
const usage = { inputTokens: 5000, outputTokens: 3000, cacheWriteTokens: 0, cacheReadTokens: 0 };

/** A fake Claude: answers by tool; `designs` are returned in order for submit_brand_design. */
function fakeClaude(o: { designs?: unknown[]; plans?: unknown[] } = {}) {
  const calls: StructuredRequest[] = [];
  const designs = [...(o.designs ?? [cardDesign])];
  const plans = [...(o.plans ?? [])];
  const client: LlmClient = {
    async structured(req) {
      calls.push(req);
      if (req.tool.name === "submit_brand_design") return { input: designs.length > 1 ? designs.shift() : designs[0], usage };
      if (req.tool.name === "plan_post_images") {
        if (plans.length) return { input: plans.length > 1 ? plans.shift() : plans[0], usage };
        const plan = JSON.parse(req.user.match(/<plan>(.*)<\/plan>/)![1]);
        const slides = (plan.slides as string[] | undefined)?.length
          ? [{ templateId: "cover", slots: { headline: plan.topic, label: plan.category }, illustration: "A dark vault" }, ...plan.slides.map((s: string, i: number) => ({ templateId: "points", slots: { number: `0${i + 1}`, headline: s }, illustration: null }))]
          : [{ templateId: "cover", slots: { headline: plan.overlayText ?? plan.topic, label: plan.category, footer: "Polygon" }, illustration: "A dark glass vault with red light" }];
        return { input: JSON.parse(JSON.stringify({ slides })), usage }; // like real JSON: no undefined values
      }
      throw new Error(`unexpected tool ${req.tool.name}`);
    },
  };
  return { client, calls };
}
function fakeImages() {
  const calls: ImageRequest[] = [];
  const client: ImageClient = {
    async generate(req) {
      calls.push(req);
      const bytes = new Uint8Array(await sharp({ create: { width: req.width, height: req.height, channels: 3, background: "#00ff00" } }).jpeg().toBuffer());
      return { bytes, contentType: "image/jpeg", width: req.width, height: req.height };
    },
  };
  return { client, calls };
}
function memoryQueue() {
  const jobs: { name: string; data: QueueJob | DesignJob; key: string }[] = [];
  const q: JobQueue = { async send(name, data, key) { jobs.push({ name, data, key }); } };
  return { q, jobs };
}

let A: OrgContext, B: OrgContext, editorA: OrgContext, brandA: string, brandB: string, igA: string;
beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, channels, brand_sources, brand_assets, brand_designs, posts, post_media, usage_ledger, plan_imports, bulk_runs, bulk_items cascade`;
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
  igA = (await addChannel(db, A, brandA, { platform: "instagram", handle: "@cherr", language: "sl", goal: { postsPerDay: 1, weekdays: [1] }, allowedTypes: ["single_image"] })).id;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

const png = (w: number, h: number, bg: string) => sharp({ create: { width: w, height: h, channels: 4, background: bg } }).png().toBuffer().then((b) => new Uint8Array(b));
async function withAssets() {
  await uploadBrandFile(db, storage, A, brandA, "logo", { filename: "logo.png", bytes: await png(600, 150, "#0000ff") });
  await uploadBrandFile(db, storage, A, brandA, "source", { filename: "pretekla-1.png", bytes: await png(1080, 1350, "#220011") });
  await uploadBrandFile(db, storage, A, brandA, "source", { filename: "pretekla-2.png", bytes: await png(1080, 1350, "#110022") });
}
async function design(claude = fakeClaude(), brief = "Temne kartice z rdečim poudarkom") {
  const { q, jobs } = memoryQueue();
  const id = await requestDesign(db, q, A, brandA, { brief });
  expect(jobs).toEqual([{ name: "brand-design", data: { designId: id }, key: `design:${brandA}` }]);
  expect(await runDesignJob(db, { llm: claude.client, storage }, { designId: id })).toBe("ready");
  return id;
}
async function post(extra: Partial<typeof posts.$inferInsert> = {}) {
  const { brand } = await getBrandDetail(db, A, brandA);
  const id = crypto.randomUUID();
  await forOrg(db, A).insert(posts, {
    id, brandId: brandA, channelId: igA, profileVersionId: brand.currentProfileVersionId!, brief: "Brief", status: "planned", format: "image",
    plan: { topic: "Zaklep", category: "The problem", overlayText: "Daš. *Zaklenjeno je.*", imagePrompt: "Vault" }, scheduledOn: "2026-10-06", createdBy: A.userId, ...extra,
  });
  return id;
}
const runImages = async (jobs: { data: unknown }[], claude: ReturnType<typeof fakeClaude>, fal: ImageClient | null) => {
  for (const j of jobs) {
    if ("itemId" in (j.data as object)) await runBulkItem(db, { llm: claude.client, storage, images: fal }, j.data as { itemId: string });
    else await runImageJob(db, { llm: claude.client, images: fal, storage }, j.data as PostImageJob);
  }
};
const state = async (id: string) => (await sql`select media_status, media_error from posts where id = ${id}`)[0];
/** The post's current images (earlier versions are archived — TASK-033). */
const media = async (id: string) => sql`select kind, position, storage_key, model from post_media where post_id = ${id} and archived_at is null order by kind, position`;

describe("brand design", () => {
  it("Claude sees the logo and past posts and the owner's words; the result becomes the current design", async () => {
    await withAssets();
    const claude = fakeClaude();
    const id = await design(claude);
    const [call] = claude.calls;
    expect(call.images!.map((i) => i.caption)).toEqual(["The brand logo:", "Past post of this brand 1/2:", "Past post of this brand 2/2:"]);
    expect(call.user).toContain("Temne kartice z rdečim poudarkom");
    expect(call.user).toContain("Ton: jasen");
    const cur = await currentDesign(db, A, brandA);
    expect(cur).toMatchObject({ id, version: 1, status: "ready" });
    expect(cur!.spec!.templates.map((t) => t.id)).toEqual(["cover", "points"]);
    expect((await sql`select state, brand_id, post_id from usage_ledger`)).toEqual([{ state: "settled", brand_id: brandA, post_id: null }]);
    expect(await currentDesign(db, B, brandA)).toBeNull();
  });

  it("an invalid answer is retried with the errors; two invalid answers fail the version", async () => {
    const bad = { ...cardDesign, templates: [cardDesign.templates[0]] };
    const claude = fakeClaude({ designs: [bad, cardDesign] });
    await design(claude);
    expect(claude.calls).toHaveLength(2);
    expect(claude.calls[1].user).toContain("did not validate");

    const { q } = memoryQueue();
    const id2 = await requestDesign(db, q, A, brandA, { brief: "x" });
    expect(await runDesignJob(db, { llm: fakeClaude({ designs: [bad] }).client, storage }, { designId: id2 })).toBe("failed");
    expect((await listDesigns(db, A, brandA))[0]).toMatchObject({ version: 2, status: "failed", error: "INVALID_OUTPUT" });
    expect((await currentDesign(db, A, brandA))!.version).toBe(1); // the failed one never becomes current
  });

  it("a revision shows Claude the current templates rendered and keeps both versions", async () => {
    await withAssets();
    const v1 = await design();
    const revised = { ...cardDesign, summary: "Popravljeno: večji naslovi." };
    const claude = fakeClaude({ designs: [revised] });
    const { q } = memoryQueue();
    await expect(requestDesign(db, q, editorA, brandA, { instruction: "naslov večji" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const v2 = await requestDesign(db, q, A, brandA, { instruction: "naslov večji" });
    await expect(requestDesign(db, q, A, brandA, { instruction: "še nekaj" })).rejects.toMatchObject({ code: "BUSY" });
    await runDesignJob(db, { llm: claude.client, storage }, { designId: v2 });
    const call = claude.calls[0];
    expect(call.user).toContain("naslov večji");
    expect(call.user).toContain("<current_design>");
    expect(call.images!.slice(-2).map((i) => i.caption)).toEqual(['Current template "cover":', 'Current template "points":']);
    expect((await currentDesign(db, A, brandA))!.spec!.summary).toBe("Popravljeno: večji naslovi.");
    await expect(activateDesign(db, editorA, v1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(activateDesign(db, B, v1)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await activateDesign(db, A, v1);
    expect((await currentDesign(db, A, brandA))!.id).toBe(v1);
  });

  it("uses the brand's chosen Claude model; an unknown or disabled model falls back to the default", async () => {
    await expect(setBrandTextModel(db, editorA, brandA, "anthropic-claude-haiku-4-5")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setBrandTextModel(db, A, brandA, "fal-flux-pro-v1-1")).rejects.toMatchObject({ code: "NOT_FOUND" }); // not a text model
    await expect(setBrandTextModel(db, B, brandA, null)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await setBrandTextModel(db, A, brandA, "anthropic-claude-haiku-4-5");
    const claude = fakeClaude();
    await design(claude);
    expect(claude.calls[0].model).toBe("claude-haiku-4-5-20251001");
    await sql`update model_registry set enabled = false where id = 'anthropic-claude-haiku-4-5'`;
    const again = fakeClaude();
    const { q } = memoryQueue();
    await runDesignJob(db, { llm: again.client, storage }, { designId: await requestDesign(db, q, A, brandA, { brief: "x" }) });
    expect(again.calls[0].model).toBe("claude-sonnet-5-5");
    await sql`update model_registry set enabled = true where id = 'anthropic-claude-haiku-4-5'`;
  });

  it("a provider failure is recorded with its status, never as a current design", async () => {
    const { q } = memoryQueue();
    const id = await requestDesign(db, q, A, brandA, { brief: "" });
    const failing: LlmClient = { async structured() { throw new LlmError("PROVIDER", "anthropic network APIConnectionTimeoutError"); } };
    expect(await runDesignJob(db, { llm: failing, storage }, { designId: id })).toBe("failed");
    expect((await listDesigns(db, A, brandA))[0]).toMatchObject({ status: "failed", error: "PROVIDER:anthropic network APIConnectionTimeoutError" });
    expect(await currentDesign(db, A, brandA)).toBeNull();
    expect(await sql`select * from usage_ledger`).toEqual([]); // the reservation was released
  });

  it("revising without a design, another org's brand, and the spend cap", async () => {
    const { q, jobs } = memoryQueue();
    await expect(requestDesign(db, q, A, brandA, { instruction: "večji" })).rejects.toMatchObject({ code: "NO_DESIGN" });
    await expect(requestDesign(db, q, B, brandA, { brief: "" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.update(orgSettings).set({ spendCapMicroUsd: 1n }).where(eq(orgSettings.orgId, A.orgId));
    const id = await requestDesign(db, q, A, brandA, { brief: "" });
    const claude = fakeClaude();
    expect(await runDesignJob(db, { llm: claude.client, storage }, jobs.at(-1)!.data as DesignJob)).toBe("failed");
    expect(claude.calls).toHaveLength(0);
    expect((await listDesigns(db, A, brandA)).find((d) => d.id === id)).toMatchObject({ status: "failed", error: "SPEND_CAP" });
  });
});

describe("post images from the design", () => {
  it("needs a design first", async () => {
    const id = await post();
    await expect(requestImages(db, memoryQueue().q, A, id, "new")).rejects.toMatchObject({ code: "NO_DESIGN" });
  });

  it("Claude picks the template and words; the illustration uses the brand's examples as style reference", async () => {
    await withAssets();
    await design();
    const id = await post();
    const { q, jobs } = memoryQueue();
    await requestImages(db, q, editorA, id, "new");
    const claude = fakeClaude();
    const fal = fakeImages();
    await runImages(jobs, claude, fal.client);
    expect(await state(id)).toEqual({ media_status: "ready", media_error: null });
    expect(claude.calls.map((c) => c.tool.name)).toEqual(["plan_post_images"]);
    expect(claude.calls[0].user).toContain('"overlayText":"Daš. *Zaklenjeno je.*"');
    expect(fal.calls).toHaveLength(1);
    expect(fal.calls[0].model).toBe("fal-ai/ideogram/v3"); // style references → the style model
    expect(fal.calls[0].references).toHaveLength(2);
    expect(fal.calls[0].references![0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(fal.calls[0].prompt).toContain("A dark glass vault with red light");
    expect(fal.calls[0].prompt).toContain(`Style: ${cardDesign.illustrationStyle}`);
    expect((await media(id)).map((m) => [m.kind, m.position])).toEqual([["background", 0], ["slide", 0]]);
    const [p] = await sql`select visual from posts where id = ${id}`;
    expect(p.visual.slides).toEqual([{ templateId: "cover", slots: { headline: "Daš. *Zaklenjeno je.*", label: "The problem", footer: "Polygon" }, illustration: "A dark glass vault with red light" }]);
    const costs = await sql`select model, cost_micro_usd::text c from usage_ledger where post_id = ${id} order by model`;
    expect(costs.find((c) => c.model === "fal-ai/ideogram/v3")!.c).toBe("60000");
    expect(costs.some((c) => c.model.startsWith("claude"))).toBe(true);
  });

  it("a persona brand: illustrations show the persona from its passport pictures; switched off → the brand's style again (TASK-027)", async () => {
    await withAssets();
    await design();
    const personaId = await createPersonaManual(db, A, brandA, { name: "Mila", handle: "", dna: {
      gender: "Female", age: "26 years old", ethnicity: "Slovenian, fair skin", hairStyle: "Pixie cut", hairColour: "Jet black", clothing: "Yellow rain jacket",
      mood: "Cheerful", environment: "Old town", camera: "Mid-shot", pose: "Walking", lighting: "Overcast", style: "Photorealistic street photography", extra: "Green eyes",
    } });
    // Without passport pictures the brand's style model is still used.
    const id0 = await post();
    let { q, jobs } = memoryQueue();
    await requestImages(db, q, A, id0, "new");
    let fal = fakeImages();
    await runImages(jobs, fakeClaude(), fal.client);
    expect(fal.calls.map((c) => c.model)).toEqual(["fal-ai/ideogram/v3"]);

    await uploadPassportImage(db, storage, A, personaId, { filename: "mila.png", bytes: await png(800, 1000, "#334455") });
    const id = await post();
    ({ q, jobs } = memoryQueue());
    await requestImages(db, q, editorA, id, "new");
    const claude = fakeClaude();
    fal = fakeImages();
    await runImages(jobs, claude, fal.client);
    expect(await state(id)).toEqual({ media_status: "ready", media_error: null });
    expect(claude.calls[0].user).toContain('<persona name="Mila">');
    expect(fal.calls).toHaveLength(1);
    expect(fal.calls[0].model).toBe("fal-ai/nano-banana-pro/edit");
    expect(fal.calls[0].references).toHaveLength(1);
    expect(fal.calls[0].prompt).toContain("SAME person as in the reference images");
    expect(fal.calls[0].prompt).toContain("Scene: A dark glass vault with red light");
    expect(fal.calls[0].prompt).toContain("Style: Photorealistic street photography");
    expect(fal.calls[0].prompt).not.toContain(cardDesign.illustrationStyle);
    const costs = await sql`select model, cost_micro_usd::text c from usage_ledger where post_id = ${id} and model like 'fal-%'`;
    expect(costs).toEqual([{ model: "fal-ai/nano-banana-pro/edit", c: "150000" }]);
    expect((await media(id)).map((m) => [m.kind, m.model])).toEqual([["background", "fal-ai/nano-banana-pro/edit"], ["slide", null]]);
    // The bulk estimate prices persona illustrations with the reference model.
    await post();
    const est = await estimateBulk(db, A, { kind: "brand", brandId: brandA, from: "2026-10-01", to: null }, ["image"]);
    expect(est.image.model).toBe("Nano Banana Pro edit (reference)");

    await setPersonaInPosts(db, A, personaId, false);
    await expect(setPersonaInPosts(db, editorA, personaId, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const id2 = await post();
    ({ q, jobs } = memoryQueue());
    await requestImages(db, q, A, id2, "new");
    const claude2 = fakeClaude();
    fal = fakeImages();
    await runImages(jobs, claude2, fal.client);
    expect(claude2.calls[0].user).not.toContain("<persona");
    expect(fal.calls.map((c) => c.model)).toEqual(["fal-ai/ideogram/v3"]);

    // Per post (TASK-031): with the brand default off, one post is made with the persona; the choice is remembered.
    const id3 = await post();
    ({ q, jobs } = memoryQueue());
    await requestImages(db, q, editorA, id3, "new", undefined, { withPersona: true });
    fal = fakeImages();
    await runImages(jobs, fakeClaude(), fal.client);
    expect(fal.calls.map((c) => c.model)).toEqual(["fal-ai/nano-banana-pro/edit"]);
    expect((await sql`select images_with_persona from posts where id = ${id3}`)[0].images_with_persona).toBe(true);
    // …and with the default on again, another post is made without it.
    await setPersonaInPosts(db, A, personaId, true);
    const id4 = await post();
    ({ q, jobs } = memoryQueue());
    await requestImages(db, q, A, id4, "new", undefined, { withPersona: false });
    fal = fakeImages();
    const claude4 = fakeClaude();
    await runImages(jobs, claude4, fal.client);
    expect(claude4.calls[0].user).not.toContain("<persona");
    expect(fal.calls.map((c) => c.model)).toEqual(["fal-ai/ideogram/v3"]);
  });

  it("the words follow the brand's language even when the channel was left on another one", async () => {
    await design();
    await sql`update brands set languages = ARRAY['en']::text[] where id = ${brandA}`; // channel igA is "sl"
    const id = await post();
    const { q, jobs } = memoryQueue();
    await requestImages(db, q, A, id, "new");
    const claude = fakeClaude();
    await runImages(jobs, claude, fakeImages().client);
    expect(claude.calls[0].user).toContain('language="English"');
    expect(claude.calls[0].system[0].text).toContain("translate them faithfully");
  });

  it("without past posts the default image model is used; a carousel gets one image per slide and only the cover is illustrated", async () => {
    await design();
    const id = await post({ format: "carousel", plan: { topic: "Koraki", slides: ["Ena", "Dva"] } });
    const { q, jobs } = memoryQueue();
    await requestImages(db, q, A, id, "new");
    const fal = fakeImages();
    await runImages(jobs, fakeClaude(), fal.client);
    expect(await state(id)).toEqual({ media_status: "ready", media_error: null });
    expect(fal.calls.map((c) => c.model)).toEqual(["fal-ai/flux-pro/v1.1"]);
    expect(fal.calls[0].references).toBeUndefined();
    expect((await listPostMedia(db, A, id)).map((m) => m.position)).toEqual([0, 1, 2]);
    expect(await listPostMedia(db, B, id)).toEqual([]);
  });

  it("edited words are re-rendered on the same illustration without Claude or fal", async () => {
    await design();
    const id = await post();
    const { q, jobs } = memoryQueue();
    await requestImages(db, q, A, id, "new");
    await runImages(jobs, fakeClaude(), fakeImages().client);
    const before = await media(id);
    await setSlideTexts(db, editorA, id, [{ headline: "Nov *naslov*", footer: "" }]);
    const [p] = await sql`select visual from posts where id = ${id}`;
    expect(p.visual.slides[0].slots).toEqual({ headline: "Nov *naslov*", label: "The problem" });
    jobs.length = 0;
    await requestImages(db, q, A, id, "text");
    const claude = fakeClaude();
    const fal = fakeImages();
    await runImages(jobs, claude, fal.client);
    expect(claude.calls).toHaveLength(0);
    expect(fal.calls).toHaveLength(0);
    const after = await media(id);
    expect(after[0].storage_key).toBe(before[0].storage_key);
    expect(after[1].storage_key).not.toBe(before[1].storage_key);
    // The earlier image is kept as a version (TASK-033), not deleted.
    expect(await storage.exists(before[1].storage_key)).toBe(true);
    const versions = await listImageVersions(db, A, id);
    expect(versions).toHaveLength(1);
    expect(versions[0].slides.map((x) => x.position)).toEqual([0]);
    // Restoring it swaps the versions; deleting the other removes only that one.
    await restoreImageVersion(db, A, id, versions[0].id);
    expect((await media(id))[1].storage_key).toBe(before[1].storage_key);
    const now = await listImageVersions(db, A, id);
    expect(now).toHaveLength(1);
    await expect(restoreImageVersion(db, B, id, now[0].id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Back to the word redraw: it still has the illustration it reused.
    await restoreImageVersion(db, A, id, now[0].id);
    expect((await media(id)).map((m) => m.storage_key)).toEqual([before[0].storage_key, after[1].storage_key]);
    // Deleting the first version keeps that illustration (the current version draws on it), and words redraw for free.
    const [first] = await listImageVersions(db, A, id);
    await deleteImageVersion(db, storage, A, id, first.id);
    expect(await listImageVersions(db, A, id)).toEqual([]);
    expect(await storage.exists(before[1].storage_key)).toBe(false);
    expect(await storage.exists(before[0].storage_key)).toBe(true);
    expect((await media(id)).map((m) => m.storage_key)).toEqual([before[0].storage_key, after[1].storage_key]);
    await expect(deleteImageVersion(db, storage, A, id, first.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    jobs.length = 0;
    await requestImages(db, q, A, id, "text");
    const fal2 = fakeImages();
    await runImages(jobs, fakeClaude(), fal2.client);
    expect(fal2.calls).toHaveLength(0);
    expect((await media(id))[0].storage_key).toBe(before[0].storage_key);
    await expect(setSlideTexts(db, B, id, [])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("partner logo (TASK-035): chosen per post, drawn next to the brand logo; changing it redraws for free; never the brand logo", async () => {
    const solid = async (hex: string) => new Uint8Array(await sharp({ create: { width: 300, height: 120, channels: 4, background: hex } }).png().toBuffer());
    // Uploaded before the brand logo: the brand logo is still the brand's own.
    const partner = await uploadBrandFile(db, storage, A, brandA, "partner", { filename: "polygon-logo.png", bytes: await solid("#1428dc"), name: "  Polygon \n Labs " });
    const logo = await uploadBrandFile(db, storage, A, brandA, "logo", { filename: "logo.png", bytes: await solid("#dc1414") });
    const other = await uploadBrandFile(db, storage, B, brandB, "partner", { filename: "x.png", bytes: await solid("#14dc14") });
    expect(await listPartnerLogos(db, A, brandA)).toEqual([{ id: partner.id, name: "Polygon Labs" }]);
    const assets = await brandAssetBytes(db, storage, A, brandA);
    expect(await sharp(assets.logo!).stats().then((x) => Math.round(x.channels[0].mean))).toBeGreaterThan(200); // red, not the partner
    expect(logo.kind).toBe("logo");

    const id = await post();
    const { q, jobs } = memoryQueue();
    await expect(setPostPartnerLogo(db, q, A, id, other.id)).rejects.toMatchObject({ code: "INVALID" }); // another org's
    await expect(setPostPartnerLogo(db, q, A, id, logo.id)).rejects.toMatchObject({ code: "INVALID" }); // the brand logo
    expect(await setPostPartnerLogo(db, q, editorA, id, partner.id)).toBe("saved"); // no images yet
    expect(jobs).toEqual([]);

    await design();
    await requestImages(db, q, A, id, "new");
    await runImages(jobs, fakeClaude(), fakeImages().client);
    const blue = async () => {
      const [m] = (await media(id)).filter((x) => x.kind === "slide");
      const { data, info } = await sharp(await storage.get(m.storage_key)).raw().toBuffer({ resolveWithObject: true });
      let n = 0;
      for (let i = 0; i < data.length; i += info.channels) if (data[i] < 60 && data[i + 1] < 80 && data[i + 2] > 180) n++;
      return n;
    };
    expect(await blue()).toBeGreaterThan(500);

    // None: the existing image is redrawn on the same illustration — no fal call — and the old one stays a version.
    jobs.length = 0;
    expect(await setPostPartnerLogo(db, q, A, id, null)).toBe("redrawn");
    expect(jobs.map((j) => j.data)).toEqual([{ postId: id, mode: "text" }]);
    const fal = fakeImages();
    await runImages(jobs, fakeClaude(), fal.client);
    expect(fal.calls).toHaveLength(0);
    expect(await blue()).toBe(0);
    expect(await listImageVersions(db, A, id)).toHaveLength(1);

    // Deleting the partner's file (on purpose) clears the choice; images stay.
    await sql`update posts set partner_logo_id = ${partner.id} where id = ${id}`;
    await deleteBrandFile(db, storage, A, "asset", partner.id);
    expect((await sql`select partner_logo_id from posts where id = ${id}`)[0].partner_logo_id).toBeNull();
    expect((await media(id)).length).toBeGreaterThan(0);
  });

  it("a correction in words: Claude sees the images and the request; only changed illustrations are drawn again (owner, 2026-10-07)", async () => {
    await design();
    const id = await post({ format: "carousel", plan: { topic: "Koraki", slides: ["Ena", "Dva"] } });
    const { q, jobs } = memoryQueue();
    await expect(requestImages(db, q, A, id, "revise", "svetlejše")).rejects.toMatchObject({ code: "BAD_STATE" }); // nothing to fix yet
    await requestImages(db, q, A, id, "new");
    await runImages(jobs, fakeClaude(), fakeImages().client);
    const [{ visual: v1 }] = await sql`select visual from posts where id = ${id}`;
    const before = await media(id);

    // Words only: the cover illustration stays, nothing is paid to fal.
    const wordsOnly = structuredClone(v1.slides);
    wordsOnly[2].slots.headline = "Dva, krajše";
    jobs.length = 0;
    await requestImages(db, q, editorA, id, "revise", "  Na tretji sliki krajši naslov.  ");
    expect(jobs[0].data).toEqual({ postId: id, mode: "revise", instruction: "Na tretji sliki krajši naslov." });
    let claude = fakeClaude({ plans: [{ slides: wordsOnly }] });
    let fal = fakeImages();
    await runImages(jobs, claude, fal.client);
    expect(await state(id)).toEqual({ media_status: "ready", media_error: null });
    expect(claude.calls[0].user).toContain("<owner_request>\nNa tretji sliki krajši naslov.\n</owner_request>");
    expect(claude.calls[0].user).toContain(JSON.stringify(v1.slides));
    expect(claude.calls[0].images).toHaveLength(3); // the current images, so Claude sees what to fix
    expect(claude.calls[0].images![0].caption).toBe("Current image 1:");
    expect(fal.calls).toHaveLength(0);
    let after = await media(id);
    expect(after.find((m) => m.kind === "background")!.storage_key).toBe(before.find((m) => m.kind === "background")!.storage_key);
    const [{ visual: v2 }] = await sql`select visual from posts where id = ${id}`;
    expect(v2.slides[2].slots.headline).toBe("Dva, krajše");
    expect(v2.revision).toBe("Na tretji sliki krajši naslov.");

    // The picture itself: the cover's illustration description changes → one new illustration.
    const brighter = structuredClone(v2.slides);
    brighter[0].illustration = "A bright glass vault, morning light, no people";
    jobs.length = 0;
    await requestImages(db, q, A, id, "revise", "Ilustracija naj bo svetla, brez ljudi.");
    claude = fakeClaude({ plans: [{ slides: brighter }] });
    fal = fakeImages();
    await runImages(jobs, claude, fal.client);
    expect(fal.calls).toHaveLength(1);
    expect(fal.calls[0].prompt).toContain("A bright glass vault, morning light, no people");
    after = await media(id);
    expect(after.filter((m) => m.kind === "background")).toHaveLength(1);
    expect(after.find((m) => m.kind === "background")!.storage_key).not.toBe(before.find((m) => m.kind === "background")!.storage_key);

    // Refusals: no words, too many words, another org.
    await expect(requestImages(db, q, A, id, "revise", "   ")).rejects.toMatchObject({ code: "INVALID" });
    await expect(requestImages(db, q, A, id, "revise", "x".repeat(1001))).rejects.toMatchObject({ code: "INVALID" });
    await expect(requestImages(db, q, B, id, "revise", "svetlejše")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a plan that names no template of the brand, twice, fails the images", async () => {
    await design();
    const id = await post();
    const { q, jobs } = memoryQueue();
    await requestImages(db, q, A, id, "new");
    await runImages(jobs, fakeClaude({ plans: [{ slides: [{ templateId: "nope", slots: {}, illustration: null }] }] }), fakeImages().client);
    expect(await state(id)).toEqual({ media_status: "failed", media_error: "INVALID_OUTPUT" });
    expect(await media(id)).toHaveLength(0);
  });

  it("the member who asked lost access → NO_ACCESS", async () => {
    await design();
    const id = await post();
    const { q, jobs } = memoryQueue();
    await requestImages(db, q, editorA, id, "new");
    await sql`delete from member where user_id = ${editorA.userId}`;
    const claude = fakeClaude();
    await runImages(jobs, claude, fakeImages().client);
    expect(claude.calls).toHaveLength(0);
    expect(await state(id)).toEqual({ media_status: "failed", media_error: "NO_ACCESS" });
  });

  it("bulk images take only brands with a design", async () => {
    const id = await post();
    const { q, jobs } = memoryQueue();
    await expect(startBulk(db, q, A, { kind: "day", date: "2026-10-06" }, ["image"])).rejects.toMatchObject({ code: "NOTHING_TO_DO" });
    await design();
    await startBulk(db, q, A, { kind: "day", date: "2026-10-06" }, ["image"]);
    const imageJobs = jobs.filter((j) => j.name === "post-image");
    expect(imageJobs).toHaveLength(1);
    await runImages(imageJobs, fakeClaude(), fakeImages().client);
    expect(await state(id)).toEqual({ media_status: "ready", media_error: null });
  });
});

describe("HTTP", () => {
  it("design previews and post images only for members of the org", async () => {
    const designId = await design();
    const deps = (ctx: OrgContext | null) => ({ db, storage, getCtx: async () => ctx });
    const ok = await handleDesignPreview(new Request(`http://x/api/designs/${designId}/preview?template=points&shape=square`), designId, deps(editorA));
    expect(ok.status).toBe(200);
    expect(await sharp(new Uint8Array(await ok.arrayBuffer())).metadata()).toMatchObject({ width: 540, height: 540 });
    expect((await handleDesignPreview(new Request(`http://x/?template=points`), designId, deps(B))).status).toBe(404);
    expect((await handleDesignPreview(new Request(`http://x/?template=nope`), designId, deps(A))).status).toBe(404);
    expect((await handleDesignPreview(new Request(`http://x/?template=Bad!`), designId, deps(A))).status).toBe(400);
    expect((await handleDesignPreview(new Request(`http://x/?template=points`), designId, deps(null))).status).toBe(401);

    const id = await post();
    const { q, jobs } = memoryQueue();
    await requestImages(db, q, A, id, "new");
    await runImages(jobs, fakeClaude(), fakeImages().client);
    const [m] = await listPostMedia(db, A, id);
    expect((await handleMedia(new Request(`http://x/api/post-media/${m.id}`), m.id, deps(B))).status).toBe(404);
    const dl = await handleMedia(new Request(`http://x/api/post-media/${m.id}?download=1`), m.id, deps(editorA));
    expect(dl.status).toBe(302);
    expect(decodeURIComponent(dl.headers.get("location")!)).toContain('filename="cherr-2026-10-06-1.png"');
  });
});

describe("animation by Claude (TASK-023)", () => {
  /** Claude stand-in for motion specs: returns `specs` in order, records the requests. */
  function motionClaude(specs: unknown[]) {
    const calls: StructuredRequest[] = [];
    const queue = [...specs];
    const client: LlmClient = { async structured(req) { calls.push(req); return { input: queue.length > 1 ? queue.shift() : queue[0], usage: { inputTokens: 2000, outputTokens: 400, cacheWriteTokens: 0, cacheReadTokens: 0 } }; } };
    return { client, calls };
  }
  const goodSpec = {
    durationS: 4,
    background: { motion: "zoom_in", amount: 0.08 },
    elements: [
      { index: 0, enter: { effect: "pop", at: 0.2, duration: 0.5 } },
      { index: 1, enter: { effect: "words", at: 0.5, duration: 1.2 } },
      { index: 2, enter: { effect: "grow_x", at: 1.4, duration: 0.6 }, loop: "none" },
      { index: 3, enter: { effect: "fade", at: 1.8, duration: 0.5 }, loop: "float" },
    ],
  };
  async function readyPost(extra: Partial<typeof posts.$inferInsert> = {}) {
    const id = await post(extra);
    const { q, jobs } = memoryQueue();
    await requestImages(db, q, A, id, "new");
    await runImages(jobs, fakeClaude(), fakeImages().client);
    return id;
  }
  const videoQueue = () => { const jobs: PostVideoJob[] = []; return { jobs, q: { async send(_n: string, data: object) { jobs.push(data as PostVideoJob); } } }; };

  it("Claude designs the motion from the template's elements; Postaja renders every frame; MP4 at the image size, in the ZIP", async () => {
    await design();
    const before = await post();
    await expect(requestAnimation(db, videoQueue().q, A, before, { position: 0, motion: "" })).rejects.toMatchObject({ code: "BAD_STATE" }); // no images yet
    const id = await readyPost();
    const { q, jobs } = videoQueue();
    await requestAnimation(db, q, editorA, id, { position: 0, motion: "Naslov besedo za besedo" });
    await expect(requestAnimation(db, q, A, id, { position: 0, motion: "" })).rejects.toMatchObject({ code: "BAD_STATE" }); // one at a time
    const claude = motionClaude([goodSpec]);
    expect(await runVideoJob(db, { llm: claude.client, storage }, jobs[0])).toBe("done");
    expect(claude.calls).toHaveLength(1);
    expect(claude.calls[0].tool.name).toBe("submit_motion");
    expect(claude.calls[0].user).toContain("<owner_wish>\nNaslov besedo za besedo\n</owner_wish>");
    expect(claude.calls[0].user).toContain('"slot":"headline","text":"Daš. *Zaklenjeno je.*"');
    expect(claude.calls[0].system[0].text).toContain(cardDesign.summary);
    expect((await sql`select video_status, video_error from posts where id = ${id}`)[0]).toEqual({ video_status: "ready", video_error: null });
    const [v] = await sql`select width, height, storage_key, spec, model, kind, slide_position from post_videos where post_id = ${id}`;
    expect(v).toMatchObject({ width: 1080, height: 1350, model: "postaja-motion", kind: "animation", slide_position: 0 });
    expect(v.spec).toMatchObject({ durationS: 4, background: { motion: "zoom_in" } });
    const probe = await probeVideo(await storage.get(v.storage_key));
    expect(probe.durationS).toBeGreaterThan(3.8);
    expect(probe.durationS).toBeLessThan(4.3);
    expect(await sql`select 1 from usage_ledger where post_id = ${id} and model like 'fal-ai/%video%'`).toHaveLength(0); // no video model is paid
    expect((await postArchive(db, storage, A, id)).entries.map((e) => e.name)).toContain("animacija-1.mp4");

    // TASK-032: what was made stays — new images keep the video, a second animation is added next to the first.
    const { q: iq, jobs: ij } = memoryQueue();
    await requestImages(db, iq, A, id, "new");
    await runImages(ij, fakeClaude(), fakeImages().client);
    expect(await storage.exists(v.storage_key)).toBe(true);
    const { q: q2, jobs: j2 } = videoQueue();
    await requestAnimation(db, q2, A, id, { position: 0, motion: "" });
    expect(await runVideoJob(db, { llm: motionClaude([goodSpec]).client, storage }, j2[0])).toBe("done");
    const all = await listPostVideos(db, A, id);
    expect(all).toHaveLength(2);
    expect((await postArchive(db, storage, A, id)).entries.map((e) => e.name).filter((n) => n.endsWith(".mp4"))).toEqual(["animacija-1.mp4", "animacija-2.mp4"]);
    // Deleted only on purpose, only within the org.
    await expect(deletePostVideo(db, storage, B, all[0].id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await deletePostVideo(db, storage, editorA, all[1].id);
    expect((await listPostVideos(db, A, id)).map((x) => x.id)).toEqual([all[0].id]);
    expect(await storage.exists(v.storage_key)).toBe(false);
    expect(await listPostVideos(db, B, id)).toEqual([]);
  }, 120_000);

  it("any image can move, text-only slides too; a spec naming missing elements is retried, twice is a failure; other orgs refused", async () => {
    await design();
    const carousel = await readyPost({ format: "carousel", plan: { topic: "Koraki", slides: ["Ena", "Dva"] } });
    const [row] = await db.select().from(posts).where(eq(posts.id, carousel));
    expect(await animatablePositions(db, A, row)).toEqual([0, 1, 2]); // the "points" slides have no illustration and still move
    const { q, jobs } = videoQueue();
    await expect(requestAnimation(db, q, B, carousel, { position: 1, motion: "" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(requestAnimation(db, q, A, carousel, { position: 7, motion: "" })).rejects.toMatchObject({ code: "NOT_ANIMATABLE" });
    await expect(requestAnimation(db, q, A, carousel, { position: 1, motion: "x".repeat(601) })).rejects.toMatchObject({ code: "INVALID" });

    await requestAnimation(db, q, A, carousel, { position: 1, motion: "" });
    const bad = { ...goodSpec, elements: [{ index: 30, enter: { effect: "fade", at: 0, duration: 1 } }] };
    const ok = { durationS: 3, background: { motion: "none", amount: 0 }, elements: [{ index: 0, enter: { effect: "pop", at: 0, duration: 0.5 } }] };
    const claude = motionClaude([bad, ok]);
    expect(await runVideoJob(db, { llm: claude.client, storage }, jobs[0])).toBe("done");
    expect(claude.calls).toHaveLength(2);
    expect(claude.calls[1].user).toContain("index 30 does not exist");

    jobs.length = 0;
    await requestAnimation(db, q, A, carousel, { position: 2, motion: "" });
    expect(await runVideoJob(db, { llm: motionClaude([bad]).client, storage }, jobs[0])).toBe("failed");
    expect((await sql`select video_error from posts where id = ${carousel}`)[0].video_error).toBe("INVALID_OUTPUT");
  }, 120_000);
});
