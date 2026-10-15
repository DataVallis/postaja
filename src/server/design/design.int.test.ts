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
import { ImageError, type ImageClient, type ImageRequest } from "../images/fal";
import { handleDesignPreview, handleMedia } from "../images/http";
import { deleteImageVersion, listImageVersions, listPostMedia, NO_WRITING, requestImages, restoreImageVersion, restoreSlideFromVersion, runImageJob, setPostPartnerLogo, setSlideTexts, type PostImageJob } from "../images/service";
import { aiPersonPosts, postArchive } from "../download/service";
import { animatablePositions, requestAnimation, runVideoJob, type PostVideoJob } from "../video/service";
import { probeVideo } from "../video/ffmpeg";
import { deletePostVideo, listPostVideos } from "../video/media";
import { LlmError, type LlmClient, type StructuredRequest } from "../llm/types";
import { createOrganization, inviteMember } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { createPersonaManual, setPersonaInPosts, uploadPassportImage } from "../personas/service";
import { estimateBulk } from "../bulk/estimate";
import { requestReel } from "../video/reel";
import { testClip } from "../../../tests/fixtures/video";
import type { VideoRequest } from "../images/fal";
import { activateDesign, brandAssetBytes, currentDesign, listDesigns, listPartnerLogos, requestDesign, restoreDesignTemplate, runDesignJob, type DesignJob } from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const storage = createS3Storage(s3ConfigFromEnv());
const profile = { cgp: "Ton: jasen, brez pretiravanja.", rules: { bannedWords: [], ctaPhrases: [], regexMust: [], regexMustNot: [] }, pillars: [], visual: { colors: { accent: "#e0112b" }, imageStyle: "", negativePrompt: "" } };
const usage = { inputTokens: 5000, outputTokens: 3000, cacheWriteTokens: 0, cacheReadTokens: 0 };

/** A fake Claude: answers by tool; `designs` are returned in order for submit_brand_design. */
function fakeClaude(o: { designs?: unknown[]; plans?: unknown[]; textInPicture?: boolean[]; reels?: unknown[]; screens?: unknown[] } = {}) {
  const calls: StructuredRequest[] = [];
  const designs = [...(o.designs ?? [cardDesign])];
  const plans = [...(o.plans ?? [])];
  const textInPicture = [...(o.textInPicture ?? [])];
  const reels = [...(o.reels ?? [])];
  const screens = [...(o.screens ?? [])];
  const client: LlmClient = {
    async structured(req) {
      calls.push(req);
      // Owner, 2026-10-15: where is the screen? By default there is none (the picture is edited with the model).
      if (req.tool.name === "screen_corners") return { input: screens.length ? screens.shift() : { found: false }, usage };
      if (req.tool.name === "submit_reel") return { input: reels.length > 1 ? reels.shift() : reels[0], usage };
      if (req.tool.name === "submit_brand_design") return { input: designs.length > 1 ? designs.shift() : designs[0], usage };
      if (req.tool.name === "plan_post_images") {
        if (plans.length) return { input: plans.length > 1 ? plans.shift() : plans[0], usage };
        const plan = JSON.parse(req.user.match(/<plan>(.*)<\/plan>/)![1]);
        const slides = (plan.slides as string[] | undefined)?.length
          ? [{ templateId: "cover", slots: { headline: plan.topic, label: plan.category }, illustration: "A dark vault" }, ...plan.slides.map((s: string, i: number) => ({ templateId: "points", slots: { number: `0${i + 1}`, headline: s }, illustration: null }))]
          : [{ templateId: "cover", slots: { headline: plan.overlayText ?? plan.topic, label: plan.category, footer: "Polygon" }, illustration: "A dark glass vault with red light" }];
        return { input: JSON.parse(JSON.stringify({ slides })), usage }; // like real JSON: no undefined values
      }
      // ADR-076: Claude looks at illustrations drawn with style references.
      if (req.tool.name === "check_illustration") return { input: { hasText: textInPicture.shift() ?? false, what: "" }, usage };
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
    plan: { topic: "Zaklep", category: "The problem", overlayText: "Daš. *Zaklenjeno je.*" }, scheduledOn: "2026-10-06", createdBy: A.userId, ...extra,
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

  it("a brand font stored before uploads were checked (variable) no longer fails the design (incident 2026-10-10)", async () => {
    const fs = await import("node:fs");
    const { isVariableFont } = await import("../files/font");
    const up = await uploadBrandFile(db, storage, A, brandA, "font", { filename: "TinySans.ttf", bytes: new Uint8Array(fs.readFileSync("tests/fixtures/fonts/TinySans.ttf")) });
    const [{ storage_key }] = await sql`select storage_key from brand_assets where id = ${up.id}`;
    await storage.put(storage_key, new Uint8Array(fs.readFileSync("tests/fixtures/fonts/TinySansVar.ttf")), "font/ttf"); // as stored before the fix
    const assets = await brandAssetBytes(db, storage, A, brandA);
    expect(isVariableFont(assets.font!)).toBe(false);
    expect(assets.fontFamily).toBe("Tiny Sans");
    const withBrandFont = { ...cardDesign, typography: { heading: "brand", body: "brand" } };
    await design(fakeClaude({ designs: [withBrandFont] }));
    expect((await currentDesign(db, A, brandA))!.spec!.typography).toEqual({ heading: "brand", body: "brand" });
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
    expect((await listDesigns(db, A, brandA))[0]).toMatchObject({ version: 2, status: "failed", error: "INVALID_OUTPUT:schema" });
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
    expect(claude.calls.map((c) => c.tool.name)).toEqual(["plan_post_images", "check_illustration"]);
    expect(claude.calls[1].images).toHaveLength(1); // the drawn illustration, checked for made-up letters (ADR-076)
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
    // TASK-045: the persona is disclosed — flagged, IPTC "digital source type" in the PNG, a note in the exported text;
    // a post without the persona has none of it, and a free word redraw keeps the flag.
    const slideRow = async (postId: string) => (await sql`select storage_key, ai_person from post_media where post_id = ${postId} and kind = 'slide' and archived_at is null`)[0];
    const marked = await slideRow(id);
    expect(marked.ai_person).toBe(true);
    const xmp = (await sharp(await storage.get(marked.storage_key)).metadata()).xmp?.toString() ?? "";
    expect(xmp).toContain("compositeWithTrainedAlgorithmicMedia");
    expect([...(await aiPersonPosts(db, A, [id, id0]))]).toEqual([id]);
    expect((await sharp(await storage.get((await slideRow(id0)).storage_key)).metadata()).xmp).toBeUndefined();
    await sql`update posts set content = ${sql.json({ caption: "Zaklenjeno je." })} where id in (${id}, ${id0})`;
    const zip = await postArchive(db, storage, A, id);
    const caption = new TextDecoder().decode(await zip.entries.find((e) => e.name === "besedilo.txt")!.bytes());
    expect(caption.trimEnd().endsWith("Oseba na sliki ali videu je ustvarjena z umetno inteligenco.")).toBe(true);
    const zip0 = await postArchive(db, storage, A, id0);
    expect(new TextDecoder().decode(await zip0.entries.find((e) => e.name === "besedilo.txt")!.bytes())).not.toContain("umetno inteligenco");
    await setSlideTexts(db, A, id, [{ headline: "Drugače", label: "" }]);
    ({ q, jobs } = memoryQueue());
    await requestImages(db, q, A, id, "text");
    await runImages(jobs, fakeClaude(), fakeImages().client);
    expect((await slideRow(id)).ai_person).toBe(true);
    ({ q, jobs } = memoryQueue());
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

  it("partner logo (TASK-046): chosen per post, drawn next to the brand logo; changing it redraws for free; never the brand logo", async () => {
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

  it("TASK-052: the plan's image prompt is used word for word; words that repeat the caption are written again", async () => {
    await design();
    const imagePrompt = "A magnifying glass made of cobalt geometric shapes over navy blocks, one amber block under the lens. No text, no letters, no logos.";
    const caption = "Engineers debug in a fixed order: evidence, root cause, smallest fix, proof. It feels slower but it is much faster.";
    const id = await post({ plan: { topic: "Debugging", imagePrompt }, content: { caption, hashtags: [] } });
    const { q, jobs } = memoryQueue();
    await requestImages(db, q, A, id, "new");
    // First answer: a text-only template that copies the caption; second: a hook on an illustrated template.
    const claude = fakeClaude({ plans: [
      { slides: [{ templateId: "points", slots: { number: "01", headline: "Engineers debug in a fixed order: evidence, root cause" }, illustration: null }] },
      { slides: [{ templateId: "cover", slots: { headline: "Slower *on purpose*." }, illustration: "Claude's own idea" }] },
    ] });
    const fal = fakeImages();
    await runImages(jobs, claude, fal.client);
    expect(claude.calls.map((c) => c.tool.name)).toEqual(["plan_post_images", "plan_post_images", "check_illustration"]);
    expect(claude.calls[0].system[0].text).toContain("never\n  repeat the caption");
    expect(claude.calls[1].user).toContain("image 1 repeats the caption");
    expect(claude.calls[1].user).toContain("the plan has an imagePrompt: the first image must use a template with illustration=true");
    expect(fal.calls.map((c) => c.prompt)).toEqual([`${imagePrompt}\n${NO_WRITING}`]); // no brand style added; only the no-writing line
    const [{ visual }] = await sql`select visual from posts where id = ${id}`;
    expect(visual.slides).toEqual([{ templateId: "cover", slots: { headline: "Slower *on purpose*." }, illustration: imagePrompt, verbatim: true }]);
    // Without an image prompt the brand's style is still added to Claude's description.
    const id2 = await post({ plan: { topic: "Vault" } });
    const j2 = memoryQueue();
    await requestImages(db, j2.q, A, id2, "new");
    const fal2 = fakeImages();
    await runImages(j2.jobs, fakeClaude(), fal2.client);
    expect(fal2.calls[0].prompt).toContain(`Style: ${cardDesign.illustrationStyle}`);
  });

  it("ADR-076: the owner's image prompt is drawn without style references; letters in a referenced picture → drawn again without them, no credits", async () => {
    await withAssets();
    await design();
    // 1) The plan's own image prompt: no past posts as references (they bring their logo, headings and motifs); checked.
    const imagePrompt = "Plain dark charcoal background with subtle film grain, bottom third empty. Square 1:1. No text, no logos.";
    const id = await post({ plan: { topic: "Build update", imagePrompt } });
    let j = memoryQueue();
    await requestImages(db, j.q, A, id, "new");
    let claude = fakeClaude({ plans: [{ slides: [{ templateId: "cover", slots: { headline: "241 tests." }, illustration: imagePrompt }] }] });
    let fal = fakeImages();
    await runImages(j.jobs, claude, fal.client);
    expect(fal.calls).toHaveLength(1);
    expect(fal.calls[0].references).toBeUndefined();
    expect(fal.calls[0].model).not.toBe("fal-ai/ideogram/v3");
    expect(fal.calls[0].prompt).toBe(`${imagePrompt}\n${NO_WRITING}`);
    expect(claude.calls.map((c) => c.tool.name)).toEqual(["plan_post_images", "check_illustration"]);

    // 2) Claude's description with style references: the picture has made-up letters → once more without references.
    const id2 = await post({ plan: { topic: "Vault" } });
    j = memoryQueue();
    await requestImages(db, j.q, A, id2, "new");
    claude = fakeClaude({ textInPicture: [true] });
    fal = fakeImages();
    await runImages(j.jobs, claude, fal.client);
    expect(await state(id2)).toEqual({ media_status: "ready", media_error: null });
    expect(claude.calls.map((c) => c.tool.name)).toEqual(["plan_post_images", "check_illustration"]);
    expect(fal.calls).toHaveLength(2);
    expect(fal.calls[0].model).toBe("fal-ai/ideogram/v3");
    expect(fal.calls[1].references).toBeUndefined();
    expect(fal.calls[1].model).not.toBe("fal-ai/ideogram/v3");
    expect(fal.calls[1].prompt).toContain("Absolutely no text of any kind");
    expect((await media(id2)).filter((m) => m.kind === "background")).toHaveLength(1);
    const rows = await sql`select model, action from usage_ledger where post_id = ${id2} and model like 'fal-ai/%' order by created_at`;
    expect(rows.map((r) => r.action)).toEqual(["illustration", "assist"]); // the second drawing costs no credits
    const checks = await sql`select action from usage_ledger where post_id = ${id2} and model like 'claude%' and action = 'assist'`;
    expect(checks.length).toBeGreaterThanOrEqual(1);
  });

  it("ADR-076: a correction can ask for the same picture to be drawn again (made-up letters); the flag is never stored", async () => {
    await design();
    const imagePrompt = "Plain dark charcoal background. No text, no logos.";
    const id = await post({ plan: { topic: "Build update", imagePrompt } });
    const { q, jobs } = memoryQueue();
    await requestImages(db, q, A, id, "new");
    const first = [{ templateId: "cover", slots: { headline: "241 tests." }, illustration: imagePrompt }];
    await runImages(jobs, fakeClaude({ plans: [{ slides: first }] }), fakeImages().client);
    const before = (await media(id)).find((m) => m.kind === "background")!;
    jobs.length = 0;
    await requestImages(db, q, A, id, "revise", "Na sliki so izmišljeni napisi, odstrani jih.");
    const claude = fakeClaude({ plans: [{ slides: [{ ...first[0], redraw: true }] }] });
    const fal = fakeImages();
    await runImages(jobs, claude, fal.client);
    expect(claude.calls[0].user).toContain("set redraw=true");
    expect(fal.calls).toHaveLength(1);
    expect(fal.calls[0].prompt).toBe(`${imagePrompt}\n${NO_WRITING}`);
    const after = (await media(id)).find((m) => m.kind === "background")!;
    expect(after.storage_key).not.toBe(before.storage_key);
    const [{ visual }] = await sql`select visual from posts where id = ${id}`;
    expect(visual.slides[0]).not.toHaveProperty("redraw");
    expect(visual.slides[0]).toMatchObject({ illustration: imagePrompt, verbatim: true });
  });

  it("owner, 2026-10-13: the owner's own prompt that brings made-up letters (a contract, a screen) is drawn once more without them, no credits", async () => {
    await design();
    const imagePrompt = "Parent at the dinner table, child sliding a hand-drawn 'contract' across; phone with the app screen.";
    const id = await post({ plan: { topic: "POV", imagePrompt } });
    const { q, jobs } = memoryQueue();
    await requestImages(db, q, A, id, "new");
    const claude = fakeClaude({ plans: [{ slides: [{ templateId: "cover", slots: { headline: "Signed." }, illustration: imagePrompt }] }], textInPicture: [true] });
    const fal = fakeImages();
    await runImages(jobs, claude, fal.client);
    expect(fal.calls.map((c) => c.prompt.split("\n").at(-1))).toEqual([NO_WRITING, expect.stringContaining("Absolutely no text of any kind")]);
    expect(fal.calls[1].prompt.startsWith(imagePrompt)).toBe(true);
    const rows = await sql`select action from usage_ledger where post_id = ${id} and model like 'fal-ai/%' order by created_at`;
    expect(rows.map((r) => r.action)).toEqual(["illustration", "assist"]);
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

describe("TASK-058: reel from several shots", () => {
  function fakeVideo() {
    const images: ImageRequest[] = [];
    const videos: VideoRequest[] = [];
    const client: ImageClient = {
      async generate(req) {
        images.push(req);
        const bytes = new Uint8Array(await sharp({ create: { width: req.width, height: req.height, channels: 3, background: "#335577" } }).jpeg().toBuffer());
        return { bytes, contentType: "image/jpeg", width: req.width, height: req.height };
      },
      async video(req) {
        videos.push(req);
        return { bytes: testClip({ width: 720, height: 1280, seconds: req.durationS }) };
      },
    };
    return { client, images, videos };
  }
  const plan = { shots: [
    { kind: "scene", firstFrame: "A family dinner table, a child slides a drawing across to a parent; the paper is blank.", motion: "The child pushes the paper, the parent raises an eyebrow.", durationS: 3, caption: "Spet to vprašanje." },
    { kind: "scene", firstFrame: "Close-up of the parent's face.", motion: "The parent smiles and nods.", durationS: 2, caption: "" },
    { kind: "screen", reference: 1, durationS: 3, caption: "Pogodba v aplikaciji." },
  ] };

  it("Claude's shots: consecutive scenes are one Kling 3.0 call from one checked first frame; a screen is the owner's picture; captions, closing card, per-second credits", async () => {
    await sql`insert into credit_prices (action, credits) values ('reel_second', 4) on conflict do nothing`; // emptied with "user" (cascade)
    await design();
    await uploadBrandFile(db, storage, editorA, brandA, "reference", { filename: "Pogodba app.png", bytes: await png(600, 1200, "#ffffff") });
    const id = await post({ format: "video", plan: { topic: "POV", imagePrompt: "Parent at dinner, child slides a hand-drawn contract" } });
    // The post's own image first (it becomes the closing card).
    const j = memoryQueue();
    await requestImages(db, j.q, A, id, "new");
    await runImages(j.jobs, fakeClaude(), fakeImages().client);

    const q: { name: string; data: unknown }[] = [];
    const queue = { async send(name: string, data: object) { q.push({ name, data }); } };
    await expect(requestReel(db, queue, A, id, { durationS: 7 as 8 })).rejects.toMatchObject({ code: "INVALID" });
    await expect(requestReel(db, queue, B, id, { durationS: 8 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await requestReel(db, queue, editorA, id, { durationS: 8, wish: "Zaslon naj bo @Pogodba app.png" });
    await expect(requestReel(db, queue, A, id, { durationS: 8 })).rejects.toMatchObject({ code: "BAD_STATE" });
    expect(q).toEqual([{ name: "post-video", data: { postId: id } }]);

    // First answer shows a reference that does not exist → asked again with the problem.
    const claude = fakeClaude({ reels: [{ shots: [plan.shots[0], { ...plan.shots[2], reference: 3 }] }, plan] });
    const fal = fakeVideo();
    expect(await runVideoJob(db, { llm: claude.client, images: fal.client, storage }, { postId: id })).toBe("done");
    const [row] = await sql`select video_status, video_error from posts where id = ${id}`;
    expect(row).toEqual({ video_status: "ready", video_error: null });
    const reelCalls = claude.calls.filter((c) => c.tool.name === "submit_reel");
    expect(reelCalls).toHaveLength(2);
    expect(reelCalls[0].user).toContain('R1: "Pogodba app.png"');
    expect(reelCalls[0].images?.[0].caption).toContain("Pogodba app.png");
    expect(reelCalls[1].user).toContain("reference R3 does not exist");
    // One first frame (9:16, brand style, no text) checked by Claude; one Kling call with one prompt per scene.
    expect(fal.images).toHaveLength(1);
    expect(fal.images[0].prompt).toContain("A family dinner table");
    expect(claude.calls.filter((c) => c.tool.name === "check_illustration")).toHaveLength(1);
    expect(fal.videos).toHaveLength(1);
    expect(fal.videos[0]).toMatchObject({ durationS: 5 });
    expect(fal.videos[0].shots?.map((x) => x.durationS)).toEqual([3, 2]);
    expect(fal.videos[0].shots?.[1].prompt).toContain("Close-up of the parent's face.");
    expect(fal.videos[0].prompt).toContain("No text, captions or logos");
    expect(Math.max(fal.videos[0].prompt.length, ...fal.videos[0].shots!.map((x) => x.prompt.length))).toBeLessThanOrEqual(500);
    const ledger = await sql`select action, credits from usage_ledger where post_id = ${id} and action = 'reel_second'`;
    expect(ledger).toEqual([{ action: "reel_second", credits: 4 * 5 }]);
    // One MP4: 3 + 2 s of scenes, 3 s of the screen, 2.5 s closing card; 1080×1920.
    const videos = await listPostVideos(db, A, id, "reel");
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({ width: 1080, height: 1920 });
    const probe = await probeVideo(await storage.get(videos[0].storageKey));
    expect(probe.durationS).toBeGreaterThan(10);
    expect(probe.durationS).toBeLessThan(11.2);
    const meta = await sql`select spec from post_videos where id = ${videos[0].id}`;
    expect(meta[0].spec.shots).toHaveLength(3);
    const zip = await postArchive(db, storage, A, id);
    expect(zip.entries.map((e) => e.name)).toContain("reel-1.mp4");
  }, 180_000);

  it("a refusal by the provider names the shots and its reason; the reserved video seconds are released", async () => {
    await sql`insert into credit_prices (action, credits) values ('reel_second', 4) on conflict do nothing`;
    await design();
    const id = await post({ format: "video" });
    const queue = { async send() {} };
    await requestReel(db, queue, A, id, { durationS: 8 });
    const fal = fakeVideo();
    fal.client.video = async () => { throw new ImageError("IMAGE_BLOCKED", "Content involving minors is not allowed"); };
    const twoScenes = { shots: [plan.shots[0], plan.shots[1], { ...plan.shots[0], durationS: 3 }] };
    expect(await runVideoJob(db, { llm: fakeClaude({ reels: [twoScenes] }).client, images: fal.client, storage }, { postId: id })).toBe("failed");
    const [row] = await sql`select video_status, video_error from posts where id = ${id}`;
    expect(row).toEqual({ video_status: "failed", video_error: "REEL_VIDEO_BLOCKED:1–3 · Content involving minors is not allowed" });
    expect(await sql`select action from usage_ledger where post_id = ${id} and action = 'reel_second'`).toEqual([]);
  }, 120_000);
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

describe("TASK-054: correcting picked images and templates, bringing one back", () => {
  /** Three images, two of them illustrated (cover · points · cover). */
  const three = [
    { templateId: "cover", slots: { headline: "Ena" }, illustration: "A red vault" },
    { templateId: "points", slots: { number: "02", headline: "Dva" }, illustration: null },
    { templateId: "cover", slots: { headline: "Tri" }, illustration: "A blue door" },
  ];
  async function carousel() {
    await design();
    const id = await post({ format: "carousel", plan: { topic: "Koraki", slides: ["Ena", "Dva", "Tri"] } });
    const { q, jobs } = memoryQueue();
    await requestImages(db, q, A, id, "new");
    const fal = fakeImages();
    await runImages(jobs, fakeClaude({ plans: [{ slides: three }] }), fal.client);
    expect(fal.calls).toHaveLength(2);
    return { id, q, jobs };
  }
  const keys = async (id: string, kind: "slide" | "background") => Object.fromEntries((await media(id)).filter((m) => m.kind === kind).map((m) => [m.position, m.storage_key]));
  const ledgerRows = async () => Number((await sql`select count(*)::int as n from usage_ledger where provider <> 'anthropic'`)[0].n);

  it("only the picked images change, whatever Claude answers for the others; the number of images stays", async () => {
    const { id, q, jobs } = await carousel();
    const bgBefore = await keys(id, "background");
    // Picks are positions of the post's images: 0 … count-1, nothing else; only with a correction.
    await expect(requestImages(db, q, A, id, "revise", "x", { only: [3] })).rejects.toMatchObject({ code: "BAD_PICK" });
    await expect(requestImages(db, q, A, id, "revise", "x", { only: [-1] })).rejects.toMatchObject({ code: "BAD_PICK" });
    await expect(requestImages(db, q, A, id, "revise", "x", { only: [0.5] })).rejects.toMatchObject({ code: "BAD_PICK" });
    await expect(requestImages(db, q, A, id, "new", undefined, { only: [0] })).rejects.toMatchObject({ code: "BAD_PICK" });
    await expect(requestImages(db, q, A, id, "text", undefined, { redraw: true })).rejects.toMatchObject({ code: "BAD_PICK" });
    expect(jobs).toHaveLength(1); // only the first "new" job; refused requests queue nothing
    jobs.length = 0;
    await requestImages(db, q, editorA, id, "revise", "Na tretji sliki krajši naslov.", { only: [2, 2] });
    expect(jobs[0].data).toEqual({ postId: id, mode: "revise", instruction: "Na tretji sliki krajši naslov.", only: [2] });
    // Claude also rewrites image 1 (words and picture) and adds a fourth image — none of that may happen.
    const answer = [
      { ...three[0], slots: { headline: "Drugačno" }, illustration: "A green field" },
      three[1],
      { ...three[2], slots: { headline: "Tri, krajše" } },
      { templateId: "points", slots: { headline: "Štiri" }, illustration: null },
    ];
    const claude = fakeClaude({ plans: [{ slides: answer }] });
    const fal = fakeImages();
    const paidBefore = await ledgerRows();
    await runImages(jobs, claude, fal.client);
    expect(await state(id)).toEqual({ media_status: "ready", media_error: null });
    expect(claude.calls[0].user).toContain("The owner picked image 3 (counting from 1)");
    expect(fal.calls).toHaveLength(0);
    expect(await ledgerRows()).toBe(paidBefore);
    const [{ visual }] = await sql`select visual from posts where id = ${id}`;
    expect(visual.slides).toEqual([three[0], three[1], { ...three[2], slots: { headline: "Tri, krajše" } }]);
    expect(visual.revisedSlides).toEqual([2]);
    expect(await keys(id, "background")).toEqual(bgBefore);
    expect((await listPostMedia(db, A, id)).map((m) => m.position)).toEqual([0, 1, 2]);
    expect((await listImageVersions(db, A, id))[0]).toMatchObject({ revisedSlides: null });
  });

  it("redraw: the picked image gets a new illustration (one paid), the others keep theirs; it can be brought back for free", async () => {
    const { id, q, jobs } = await carousel();
    const bgBefore = await keys(id, "background");
    const slidesBefore = await keys(id, "slide");
    jobs.length = 0;
    await requestImages(db, q, A, id, "revise", "Na prvi sliki je odvečen pravokotnik.", { only: [0], redraw: true });
    expect(jobs[0].data).toMatchObject({ only: [0], redraw: true });
    const fal = fakeImages();
    const paid0 = await ledgerRows();
    await runImages(jobs, fakeClaude({ plans: [{ slides: three }] }), fal.client); // Claude changes nothing itself
    expect(fal.calls).toHaveLength(1);
    expect(await ledgerRows()).toBe(paid0 + 1);
    expect(fal.calls[0].prompt).toContain("A red vault");
    const bgAfter = await keys(id, "background");
    expect(bgAfter[0]).not.toBe(bgBefore[0]);
    expect(bgAfter[2]).toBe(bgBefore[2]);
    const [{ visual }] = await sql`select visual from posts where id = ${id}`;
    expect(visual.slides[0]).not.toHaveProperty("redraw");

    // Image 1 of the version before comes back: its illustration again, the others as they are now, no AI call.
    const [prev] = await listImageVersions(db, A, id);
    expect(prev.slides.map((s) => s.position)).toEqual([0, 1, 2]);
    await expect(restoreSlideFromVersion(db, q, B, id, prev.id, 0)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(restoreSlideFromVersion(db, q, A, id, prev.id, 3)).rejects.toMatchObject({ code: "NOT_RESTORABLE" });
    await expect(restoreSlideFromVersion(db, q, A, id, prev.id, -1)).rejects.toMatchObject({ code: "NOT_RESTORABLE" });
    jobs.length = 0;
    const paidBefore = await ledgerRows();
    await restoreSlideFromVersion(db, q, editorA, id, prev.id, 0);
    expect(jobs.map((j) => j.data)).toEqual([{ postId: id, mode: "text" }]);
    const claude = fakeClaude();
    const fal2 = fakeImages();
    await runImages(jobs, claude, fal2.client);
    expect(claude.calls).toHaveLength(0);
    expect(fal2.calls).toHaveLength(0);
    expect(await ledgerRows()).toBe(paidBefore);
    expect(await keys(id, "background")).toEqual(bgBefore);
    expect(Object.values(await keys(id, "slide")).some((k) => Object.values(slidesBefore).includes(k))).toBe(false); // drawn again
    // Both earlier states stay as versions; the redrawn illustration is still there to bring back.
    const versions = await listImageVersions(db, A, id);
    expect(versions).toHaveLength(2);
    expect(await storage.exists(bgAfter[0])).toBe(true);
    await restoreSlideFromVersion(db, q, A, id, versions[0].id, 0);
    await runImages(jobs.slice(-1), fakeClaude(), fakeImages().client);
    expect((await keys(id, "background"))[0]).toBe(bgAfter[0]);
  });

  it("TASK-057: a tagged reference picture is edited into the picked illustration as it is; the rest stays", async () => {
    const { id, q, jobs } = await carousel();
    const bgBefore = await keys(id, "background");
    // Any member adds a reference picture (never a style example); only owners add logos.
    await expect(uploadBrandFile(db, storage, editorA, brandA, "logo", { filename: "l.png", bytes: await png(300, 100, "#ff0000") })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const cert = await uploadBrandFile(db, storage, editorA, brandA, "reference", { filename: "Certificate (EN)@2x.png", bytes: await png(800, 600, "#ffffff") });
    expect(cert).toMatchObject({ table: "asset", kind: "reference" });
    const other = await uploadBrandFile(db, storage, B, brandB, "reference", { filename: "tuj.png", bytes: await png(200, 200, "#000000") });
    jobs.length = 0;
    await requestImages(db, q, editorA, id, "revise", "Slika 1 naj v telefonu vsebuje certifikat @Certificate (EN)@2x.png", { refs: [`asset:${other.id}`, "asset:../x"] });
    expect(jobs[0].data).toEqual({ postId: id, mode: "revise", instruction: "Slika 1 naj v telefonu vsebuje certifikat @Certificate (EN)@2x.png", refs: [`asset:${cert.id}`] });
    const answer = [{ ...three[0], illustration: "A hand holding a phone; on its screen the certificate R1, readable", references: [1, 7] }, three[1], { ...three[2], references: [1] }];
    const claude = fakeClaude({ plans: [{ slides: answer }] });
    const fal = fakeImages();
    const paid0 = await ledgerRows();
    await runImages(jobs, claude, fal.client);
    expect(await state(id)).toEqual({ media_status: "ready", media_error: null });
    expect(claude.calls[0].user).toContain('R1: "Certificate (EN)@2x.png"');
    expect(claude.calls[0].images?.map((b) => b.caption)).toEqual(["Current image 1:", "Current image 2:", "Current image 3:", 'Reference R1 "Certificate (EN)@2x.png":']);
    // Image 1 is edited with the reference model from its current picture + the certificate; image 3 is unchanged
    // (Claude asked for the reference there too, but neither its description nor anything else changed — still edited).
    expect(fal.calls.map((c) => [c.model, c.references?.length])).toEqual([["fal-ai/nano-banana-pro/edit", 2], ["fal-ai/nano-banana-pro/edit", 2]]);
    expect(fal.calls[0].prompt).toContain("Edit image 1, the current picture");
    expect(fal.calls[0].prompt).toContain('image 2 ("Certificate (EN)@2x.png")');
    expect(fal.calls[0].negativePrompt).toBeUndefined();
    expect(fal.calls[0].prompt).toContain("Remove every letter, caption, label, sign or text-like mark of image 1");
    // The checker sees the illustration and the reference (whose own writing is allowed).
    const checks = claude.calls.filter((c) => c.tool.name === "check_illustration");
    expect(checks).toHaveLength(2);
    expect(checks[0].images).toHaveLength(2);
    expect(checks[0].user).toContain("reference pictures");
    expect(await ledgerRows()).toBe(paid0 + 2);
    const bgAfter = await keys(id, "background");
    expect(bgAfter[0]).not.toBe(bgBefore[0]);
    const [{ visual }] = await sql`select visual from posts where id = ${id}`;
    expect(visual.slides.some((x: object) => "references" in x)).toBe(false);
    // Picked images only: the reference is drawn only into image 1. Stray writing carried over from the current
    // picture → drawn once more from the description and the reference only, at no credit.
    jobs.length = 0;
    await requestImages(db, q, A, id, "revise", "Certifikat @certificate (en)@2x.png večji.", { only: [0] });
    expect(jobs[0].data).toMatchObject({ only: [0], refs: [`asset:${cert.id}`] });
    const fal2 = fakeImages();
    const paid1 = await ledgerRows();
    await runImages(jobs, fakeClaude({ plans: [{ slides: answer }], textInPicture: [true] }), fal2.client);
    expect(fal2.calls.map((c) => c.references?.length)).toEqual([2, 1]);
    expect(fal2.calls[1].prompt).toContain("anywhere except inside the reference pictures");
    expect(fal2.calls[1].prompt).not.toContain("Edit image 1");
    const actions = await sql`select action from usage_ledger where post_id = ${id} and model like 'fal-ai/%' order by created_at desc limit 2`;
    expect(actions.map((r) => r.action).sort()).toEqual(["assist", "illustration"]);
    expect(await ledgerRows()).toBe(paid1 + 2);
    expect((await keys(id, "background"))[2]).toBe(bgAfter[2]);
  });

  it("owner, 2026-10-15: a screenshot onto the phone already in the picture is placed exactly — no image model, no credits; corners corrected once", async () => {
    const { id, q, jobs } = await carousel();
    const bgBefore = await keys(id, "background");
    const shot = await uploadBrandFile(db, storage, A, brandA, "reference", { filename: "IMG_9258.jpg", bytes: await png(300, 600, "#ff0000") });
    jobs.length = 0;
    await requestImages(db, q, A, id, "revise", "Na prvi sliki zamenjaj zaslon telefona z @IMG_9258.jpg", { only: [0] });
    expect(jobs[0].data).toMatchObject({ refs: [`asset:${shot.id}`] });
    const answer = [{ ...three[0], references: [1] }, three[1], three[2]];
    // The illustration is shown at most 1000 px; the stand-in pictures here are smaller, so pixels are as they are.
    const claude = fakeClaude({ plans: [{ slides: answer }], screens: [
      { use: "screen", corners: [{ x: 10, y: 10 }, { x: 60, y: 12 }, { x: 58, y: 110 }, { x: 8, y: 108 }] },
      { use: "screen", ok: false, corners: [{ x: 12, y: 12 }, { x: 62, y: 12 }, { x: 62, y: 112 }, { x: 12, y: 112 }] },
      { use: "screen", ok: true },
    ] });
    const fal = fakeImages();
    const paid0 = await ledgerRows();
    await runImages(jobs, claude, fal.client);
    expect(await state(id)).toEqual({ media_status: "ready", media_error: null });
    expect(fal.calls).toHaveLength(0);
    expect(await ledgerRows()).toBe(paid0);
    const screenCalls = claude.calls.filter((c) => c.tool.name === "screen_corners");
    expect(screenCalls).toHaveLength(3);
    expect(screenCalls[0].user).toContain("Na prvi sliki zamenjaj zaslon telefona");
    expect(screenCalls[0].images).toHaveLength(2);
    expect(screenCalls[1].images).toHaveLength(2); // the result and a close-up of the screen
    const bgAfter = await keys(id, "background");
    expect(bgAfter[0]).not.toBe(bgBefore[0]);
    expect(bgAfter[2]).toBe(bgBefore[2]);
    // The screenshot is in the picture pixel for pixel (red), at the corrected corners.
    const { data, info } = await sharp(await storage.get(bgAfter[0])).raw().toBuffer({ resolveWithObject: true });
    const k = Math.max(info.width, info.height) > 1000 ? Math.max(info.width, info.height) / 1000 : 1;
    const at = (x: number, y: number) => data[(Math.round(y * k) * info.width + Math.round(x * k)) * info.channels];
    expect(at(37, 60)).toBeGreaterThan(220);
    const media = await sql`select model, prompt from post_media where post_id = ${id} and kind = 'background' and position = 0 and archived_at is null`;
    expect(media[0]).toMatchObject({ model: "postaja/screen", prompt: "screen: IMG_9258.jpg" });
  });

  it("owner, 2026-10-15 (2): his screenshot is already a phone mockup and should cover it all — it becomes the whole picture, no credits", async () => {
    const { id, q, jobs } = await carousel();
    const bgBefore = await keys(id, "background");
    const [before] = await sql`select width, height from post_media where storage_key = ${bgBefore[0]}`;
    const shot = await uploadBrandFile(db, storage, A, brandA, "reference", { filename: "IMG_9258.jpg", bytes: await png(300, 600, "#00ff00") });
    jobs.length = 0;
    await requestImages(db, q, A, id, "revise", "slika telefona mora biti čez celo, moja slika @IMG_9258.jpg", { only: [0] });
    expect(jobs[0].data).toMatchObject({ refs: [`asset:${shot.id}`] });
    const claude = fakeClaude({ plans: [{ slides: [{ ...three[0], references: [1] }, three[1], three[2]] }], screens: [{ use: "whole" }] });
    const fal = fakeImages();
    const paid0 = await ledgerRows();
    await runImages(jobs, claude, fal.client);
    expect(await state(id)).toEqual({ media_status: "ready", media_error: null });
    expect(fal.calls).toHaveLength(0);
    expect(await ledgerRows()).toBe(paid0);
    expect(claude.calls.filter((c) => c.tool.name === "screen_corners")).toHaveLength(1);
    const bgAfter = await keys(id, "background");
    const media = await sql`select model, prompt, width, height from post_media where post_id = ${id} and kind = 'background' and position = 0 and archived_at is null`;
    expect(media[0]).toMatchObject({ model: "postaja/whole", prompt: "whole: IMG_9258.jpg", width: before.width, height: before.height });
    // His picture, whole: the middle is his green.
    const { data, info } = await sharp(await storage.get(bgAfter[0])).raw().toBuffer({ resolveWithObject: true });
    const o = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    expect(data[o]).toBeLessThan(40);
    expect(data[o + 1]).toBeGreaterThan(220);
    expect(data[o + 2]).toBeLessThan(40);
  });

  it("an image made with another design version cannot come back without being planned again", async () => {
    const { id, q, jobs } = await carousel();
    jobs.length = 0;
    await requestImages(db, q, A, id, "revise", "Krajši naslov.", { only: [1] });
    await runImages(jobs, fakeClaude({ plans: [{ slides: three }] }), fakeImages().client);
    const [prev] = await listImageVersions(db, A, id);
    await design(fakeClaude(), "Nova podoba"); // a new design version is now current
    await expect(restoreSlideFromVersion(db, q, A, id, prev.id, 1)).rejects.toMatchObject({ code: "NOT_RESTORABLE" });
  });

  it("design: a revision of picked templates keeps everything else as it was", async () => {
    const v1 = await design();
    const { q } = memoryQueue();
    await expect(requestDesign(db, q, A, brandA, { instruction: "večji naslov", templates: ["nope"] })).rejects.toMatchObject({ code: "BAD_PICK" });
    await expect(requestDesign(db, q, A, brandA, { brief: "x", templates: ["points"] })).rejects.toMatchObject({ code: "BAD_PICK" });
    await expect(requestDesign(db, q, editorA, brandA, { instruction: "večji naslov", templates: ["points"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const v2 = await requestDesign(db, q, A, brandA, { instruction: "Seznam: večji naslov", templates: ["points", "points"] });
    // Claude changes the palette, the summary, the cover and the list — only the list may change.
    const answer = structuredClone(cardDesign);
    answer.summary = "Vse drugače";
    answer.palette.accent = "#00ff00";
    answer.templates[0].name = "Spremenjena naslovnica";
    answer.templates[1].name = "Seznam z večjim naslovom";
    const claude = fakeClaude({ designs: [answer] });
    expect(await runDesignJob(db, { llm: claude.client, storage }, { designId: v2 })).toBe("ready");
    expect(claude.calls[0].user).toContain('The owner picked only this template: "points"');
    const now = (await currentDesign(db, A, brandA))!;
    expect(now.id).toBe(v2);
    expect(now.onlyTemplates).toEqual(["points"]);
    const before = (await listDesigns(db, A, brandA)).find((d) => d.id === v1)!.spec!;
    expect(now.spec!.summary).toBe(before.summary);
    expect(now.spec!.palette).toEqual(before.palette);
    expect(now.spec!.templates[0]).toEqual(before.templates[0]);
    expect(now.spec!.templates[1].name).toBe("Seznam z večjim naslovom");
  });

  it("design: one template of an earlier version comes back as a new version, without Claude", async () => {
    const v1 = await design();
    const { q } = memoryQueue();
    const v2 = await requestDesign(db, q, A, brandA, { instruction: "vse drugače" });
    const answer = structuredClone(cardDesign);
    answer.templates[0].name = "Nova naslovnica";
    answer.templates[1].name = "Nov seznam";
    await runDesignJob(db, { llm: fakeClaude({ designs: [answer] }).client, storage }, { designId: v2 });
    await expect(restoreDesignTemplate(db, editorA, v1, "cover")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(restoreDesignTemplate(db, B, v1, "cover")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(restoreDesignTemplate(db, A, v1, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(restoreDesignTemplate(db, A, v2, "cover")).rejects.toMatchObject({ code: "NOT_RESTORABLE" }); // already in use
    const paid = Number((await sql`select count(*)::int as n from usage_ledger`)[0].n);
    const v3 = await restoreDesignTemplate(db, A, v1, "cover");
    expect(Number((await sql`select count(*)::int as n from usage_ledger`)[0].n)).toBe(paid);
    const now = (await currentDesign(db, A, brandA))!;
    expect(now).toMatchObject({ id: v3, version: 3, status: "ready", basedOn: v2, restoredFrom: { version: 1, templateId: "cover", name: "Naslovnica" } });
    expect(now.spec!.templates.map((t) => t.name)).toEqual(["Naslovnica", "Nov seznam"]);
    expect((await listDesigns(db, A, brandA)).map((d) => d.version)).toEqual([3, 2, 1]);
  });
});
