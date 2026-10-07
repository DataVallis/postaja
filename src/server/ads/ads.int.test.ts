// Ads (TASK-021): networks seeded from data, copy written per network with limits, one fix round, checks on save,
// copy.csv, refusals and tenancy.
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { createBrand, saveProfile } from "../brands/service";
import sharp from "sharp";
import { cardDesign } from "../../../tests/fixtures/design";
import { unzip } from "../files/zip";
import { adMedia, brandDesigns, brands, orgSettings } from "../db/schema";
import { designSpecSchema } from "../design/spec";
import { createS3Storage, s3ConfigFromEnv } from "../files/storage";
import type { ImageClient, ImageRequest } from "../images/fal";
import type { LlmClient, StructuredRequest } from "../llm/types";
import { adImageEstimate, adMediaUrl, adZip, copyForImage, listAdMedia, renderAdImages, requestAdImages, runAdImageJob, setAdSlides, type AdImageJob } from "./creatives";
import { createFakeLlm } from "../llm/fake";
import { LlmError } from "../llm/types";
import { createOrganization, inviteMember } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { adCopyCsv, adNetworkInfo, createAdSet, getAdSet, listAdSets, saveAdCopy, writeAdCopy } from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const profile = {
  cgp: "AI Builders: tečaj Vibe Coding 101 za ne-programerje.", rules: { bannedWords: ["poceni"], ctaPhrases: [], regexMust: [], regexMustNot: [] },
  pillars: [], visual: { colors: {}, imageStyle: "", negativePrompt: "" },
};

let A: OrgContext, B: OrgContext, editorA: OrgContext, brandA: string;
beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, channels, posts, usage_ledger, ad_sets, ad_media, brand_designs cascade`;
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
  brandA = (await createBrand(db, A, { name: "AI Builders", slug: "aib", languages: ["sl", "en"] })).id;
  await saveProfile(db, A, brandA, { ...profile, note: "t" });
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

const storage = createS3Storage(s3ConfigFromEnv());
const metaCopy = (headline: string, cta = "Sign Up") => ({ primary_text: "Zgradi svojo prvo aplikacijo v enem vikendu.", headline, description: "Brez programiranja", cta });
const googleCopy = { headlines: ["Vibe Coding 101", "Aplikacija brez kode"], long_headline: "Zgradi aplikacijo z AI v enem vikendu", descriptions: ["Tečaj za ne-programerje."], business_name: "AI Builders" };
const answer = (headlines: string[]) => ({ input: { variants: headlines.map((h) => ({ meta: metaCopy(h), google_display: googleCopy })) } });
const base = { brandId: "", objective: "leads" as const, networks: ["meta", "google_display"] as ("meta" | "google_display")[], placements: ["fb_feed_portrait", "ig_story_image", "gdn_responsive_square"], offer: "20 % popusta do 31. 10.", landingUrl: "aibuilders.si/tecaj" };

describe("ad networks", () => {
  it("are data: fields, limits, CTA buttons and placements from the seeded presets", async () => {
    const nets = await adNetworkInfo(db);
    expect(nets.map((n) => n.key)).toEqual(["meta", "linkedin", "google_display"]);
    const meta = nets[0];
    expect(meta.fields.find((f) => f.key === "headline")).toMatchObject({ maxChars: 40, recommended: 27 });
    expect(meta.ctas).toContain("Learn More");
    expect(meta.placements.map((p) => [p.key, p.width, p.height])).toEqual([["fb_feed_portrait", 1080, 1350], ["fb_feed_square", 1080, 1080], ["ig_story_image", 1080, 1920]]);
    expect(nets[2].fields.find((f) => f.key === "headlines")).toMatchObject({ max: 5, maxChars: 30 });
  });
});

describe("writing ad copy", () => {
  it("one call per concept with each network's fields and limits; a broken limit gets one fix round; ready after it", async () => {
    const llm = createFakeLlm([
      answer(["Naslov, ki je zagotovo predolg za Metin oglas, ja", "Kratek naslov", "Še en"]), // variant 1 headline > 40
      answer(["Zgradi aplikacijo v vikendu", "Kratek naslov", "Še en"]),
    ]);
    const id = await createAdSet(db, { llm: llm.client }, editorA, { ...base, brandId: brandA, placements: [...base.placements, "li_feed_square"] });
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[0].tool.name).toBe("submit_ad_copy");
    expect(llm.requests[0].user).toContain("AI Builders: tečaj Vibe Coding 101");
    expect(llm.requests[0].user).toContain('landing_url="https://aibuilders.si/tecaj"');
    expect(llm.requests[0].user).toContain("headline (≤ 40, visible 27)");
    expect(llm.requests[0].user).not.toContain("linkedin");
    expect(llm.requests[1].user).toContain("variant 1, meta.headline: too_long (49 vs 40)");
    const a = await getAdSet(db, A, id);
    expect(a).toMatchObject({ status: "ready", language: "sl", landingUrl: "https://aibuilders.si/tecaj", error: null, name: "20 % popusta do 31. 10." });
    expect(a.placements).toEqual(["fb_feed_portrait", "ig_story_image", "gdn_responsive_square"]); // LinkedIn not chosen → its placement dropped
    expect(a.copy).toHaveLength(3);
    expect(a.copy[0].meta).toEqual(metaCopy("Zgradi aplikacijo v vikendu"));
    expect(a.issues.filter((i) => i.code !== "long_visible")).toEqual([]);
    expect((await sql`select count(*)::int n from usage_ledger where org_id = ${A.orgId} and brand_id = ${brandA}`)[0].n).toBe(2);
  });

  it("still broken after the fix round → needs review with the issues listed", async () => {
    const bad = answer(["Ta naslov je predolg za Meto in ostane predolg tudi po popravku", "Ok", "Poceni tečaj"]);
    const llm = createFakeLlm([bad, bad]);
    const id = await createAdSet(db, { llm: llm.client }, A, { ...base, brandId: brandA });
    const a = await getAdSet(db, A, id);
    expect(a.status).toBe("needs_review");
    expect(a.issues.map((i) => [i.variant, i.field, i.code]).filter(([, , c]) => c !== "long_visible")).toEqual([[0, "headline", "too_long"], [2, "headline", "banned_word"]]);
  });

  it("provider failures and the spend cap are stored on the ad set, which can be written again", async () => {
    const id = await createAdSet(db, { llm: createFakeLlm([{ error: new LlmError("PROVIDER", "overloaded") }]).client }, A, { ...base, brandId: brandA });
    expect(await getAdSet(db, A, id)).toMatchObject({ status: "draft", error: "AI_FAILED:overloaded", copy: [] });
    await writeAdCopy(db, { llm: createFakeLlm([answer(["A", "B", "C"])]).client }, A, id);
    expect(await getAdSet(db, A, id)).toMatchObject({ status: "ready", error: null });
    await db.update(orgSettings).set({ spendCapMicroUsd: 0n }).where(eq(orgSettings.orgId, A.orgId));
    await writeAdCopy(db, { llm: createFakeLlm([answer(["A", "B", "C"])]).client }, A, id);
    expect((await getAdSet(db, A, id)).error).toBe("SPEND_CAP");
  });

  it("refuses bad input: no placement of a chosen network, a language the brand lacks, a non-web landing page", async () => {
    const llm = createFakeLlm([]);
    await expect(createAdSet(db, { llm: llm.client }, A, { ...base, brandId: brandA, placements: ["li_feed_square"] })).rejects.toMatchObject({ code: "NO_PLACEMENT" });
    await expect(createAdSet(db, { llm: llm.client }, A, { ...base, brandId: brandA, language: "de" })).rejects.toMatchObject({ code: "LANGUAGE" });
    await expect(createAdSet(db, { llm: llm.client }, A, { ...base, brandId: brandA, landingUrl: "javascript:alert(1)" })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createAdSet(db, { llm: llm.client }, B, { ...base, brandId: brandA })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(llm.requests).toHaveLength(0);
    expect(await listAdSets(db, A, brandA)).toEqual([]);
  });
});

describe("editing and export", () => {
  it("saved copy is checked again; copy.csv has one row per network × placement × variant; other orgs see nothing", async () => {
    const id = await createAdSet(db, { llm: createFakeLlm([answer(["Prvi", "Drugi", "Tretji"])]).client }, A, { ...base, brandId: brandA });
    const a = await getAdSet(db, A, id);
    const edited = structuredClone(a.copy);
    edited[1].meta!.headline = "x".repeat(41);
    edited[2].google_display!.headlines = ["Ena", "", "Dva"];
    await saveAdCopy(db, editorA, id, edited as never);
    let after = await getAdSet(db, A, id);
    expect(after.status).toBe("needs_review");
    expect(after.issues.filter((i) => i.code === "too_long")).toEqual([{ variant: 1, network: "meta", field: "headline", code: "too_long", actual: 41, limit: 40 }]);
    expect(after.copy[2].google_display!.headlines).toEqual(["Ena", "Dva"]);
    edited[1].meta!.headline = "Popravljen";
    await saveAdCopy(db, A, id, edited as never);
    after = await getAdSet(db, A, id);
    expect(after.status).toBe("ready");

    const { csv, filename } = await adCopyCsv(db, A, id);
    expect(filename).toMatch(/^aib-oglas-.{8}-copy\.csv$/);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("ad_set;network;placement;width;height;variant;primary_text;headline;description;headlines;long_headline;descriptions;business_name;cta;landing_url;image_file");
    expect(lines).toHaveLength(1 + (2 + 1) * 3); // meta: feed 4:5 + story; google: square — × 3 variants
    expect(lines[1]).toBe("20 % popusta do 31. 10.;meta;fb_feed_portrait;1080;1350;1;Zgradi svojo prvo aplikacijo v enem vikendu.;Prvi;Brez programiranja;;;;;Sign Up;https://aibuilders.si/tecaj;"); // no image yet
    expect(lines.find((l) => l.includes("gdn_responsive_square;1200;1200;3"))).toContain("Ena | Dva");

    await expect(getAdSet(db, B, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(saveAdCopy(db, B, id, edited as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(adCopyCsv(db, B, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listAdSets(db, B, brandA)).toEqual([]);
  });
});

describe("creatives (TASK-021b)", () => {
  async function giveDesign() {
    const id = crypto.randomUUID();
    await db.insert(brandDesigns).values({ id, orgId: A.orgId, brandId: brandA, version: 1, status: "ready", spec: designSpecSchema.parse(cardDesign), createdBy: A.userId });
    await db.update(brands).set({ currentDesignId: id }).where(eq(brands.id, brandA));
  }
  function plans(visuals: unknown[]) {
    const calls: StructuredRequest[] = [];
    const client: LlmClient = { async structured(req) { calls.push(req); return { input: JSON.parse(JSON.stringify({ visuals })), usage: { inputTokens: 900, outputTokens: 300, cacheWriteTokens: 0, cacheReadTokens: 0 } }; } };
    return { client, calls };
  }
  function fal() {
    const calls: ImageRequest[] = [];
    const client: ImageClient = {
      async generate(req) {
        calls.push(req);
        return { bytes: new Uint8Array(await sharp({ create: { width: req.width, height: req.height, channels: 3, background: "#204060" } }).jpeg().toBuffer()), contentType: "image/jpeg", width: req.width, height: req.height };
      },
    };
    return { client, calls };
  }
  const visuals = [
    { templateId: "cover", slots: { headline: "Prvi *vikend*", label: "Webinar" }, illustration: "A laptop on a desk at dawn" },
    { templateId: "points", slots: { headline: "Drugi naslov", number: "01" }, illustration: null },
    { templateId: "cover", slots: { headline: "Tretji" }, illustration: "A calm workspace" },
  ];
  async function adSet() {
    return createAdSet(db, { llm: createFakeLlm([answer(["Zgradi v vikendu", "Brez kode", "Začni danes"])]).client }, A, { ...base, brandId: brandA });
  }
  const queue = () => { const jobs: AdImageJob[] = []; return { jobs, q: { async send(_n: string, data: object) { jobs.push(data as AdImageJob); } } }; };

  it("Claude picks a template and words per variant; one illustration per illustrated variant; every placement in its exact size", async () => {
    const id = await adSet();
    const { q, jobs } = queue();
    await expect(requestAdImages(db, q, A, id, "new")).rejects.toMatchObject({ code: "BAD_STATE", detail: "NO_DESIGN" });
    await giveDesign();
    const est = await adImageEstimate(db, A, await getAdSet(db, A, id));
    expect(est!.illustrations).toBe(3);
    await requestAdImages(db, q, editorA, id, "new");
    await expect(requestAdImages(db, q, A, id, "new")).rejects.toMatchObject({ detail: "BUSY" }); // one at a time
    const claude = plans(visuals);
    const images = fal();
    expect(await runAdImageJob(db, { llm: claude.client, images: images.client, storage }, jobs[0])).toBe("done");
    expect(claude.calls).toHaveLength(1);
    expect(claude.calls[0].tool.name).toBe("plan_ad_visuals");
    expect(claude.calls[0].user).toContain("<headline>Zgradi v vikendu</headline>");
    expect(images.calls).toHaveLength(2); // the "points" variant has no illustration
    expect(images.calls[0].width).toBe(images.calls[0].height); // square, ~1 MP, cropped into each placement's box
    expect(images.calls[0].width * images.calls[0].height).toBeLessThanOrEqual(1_000_000);
    expect(images.calls[0].prompt).toContain("A laptop on a desk at dawn");
    const a = await getAdSet(db, A, id);
    expect(a.mediaStatus).toBe("ready");
    expect(a.visual!.variants.map((v) => v.templateId)).toEqual(["cover", "points", "cover"]);
    const media = await listAdMedia(db, A, id);
    expect(media).toHaveLength(3 * 3); // fb 4:5, IG story 9:16, Google 1:1 × 3 variants
    const story = media.find((m) => m.placement === "ig_story_image")!;
    expect([story.width, story.height]).toEqual([1080, 1920]);
    const stored = await db.select().from(adMedia).where(eq(adMedia.id, story.id));
    expect(await sharp(await storage.get(stored[0].storageKey)).metadata()).toMatchObject({ width: 1080, height: 1920, format: "png" });
    const costs = await sql`select model, post_id, brand_id from usage_ledger where org_id = ${A.orgId} and model like 'fal-ai/%'`;
    expect(costs).toHaveLength(2);
    expect(costs.every((c) => c.post_id === null && c.brand_id === brandA)).toBe(true);

    // copy.csv names each row's image; the ZIP holds it and a folder per placement.
    const { csv } = await adCopyCsv(db, A, id);
    expect(csv).toContain(";fb_feed_portrait/aib_20-popusta-do-31-10_fb_feed_portrait_v1.png");
    const z = await adZip(db, storage, A, id);
    expect(z.filename).toBe("aib_20-popusta-do-31-10.zip");
    const names = unzip(new Uint8Array(await new Response(z.stream).arrayBuffer())).map((e) => e.name);
    expect(names[0]).toBe("copy.csv");
    expect(names).toContain("ig_story_image/aib_20-popusta-do-31-10_ig_story_image_v3.png");
    expect(names).toHaveLength(1 + 9);
  });

  it("corrected words redraw every placement on the same illustrations, without Claude or fal", async () => {
    await giveDesign();
    const id = await adSet();
    const { q, jobs } = queue();
    await requestAdImages(db, q, A, id, "new");
    await runAdImageJob(db, { llm: plans(visuals).client, images: fal().client, storage }, jobs[0]);
    const before = await db.select().from(adMedia).where(eq(adMedia.adSetId, id));
    await setAdSlides(db, editorA, id, [{ headline: "Nov *naslov*", label: "" }]);
    expect((await getAdSet(db, A, id)).visual!.variants[0].slots).toEqual({ headline: "Nov *naslov*" });
    jobs.length = 0;
    await requestAdImages(db, q, A, id, "text");
    const claude = plans(visuals);
    const images = fal();
    await runAdImageJob(db, { llm: claude.client, images: images.client, storage }, jobs[0]);
    expect(claude.calls).toHaveLength(0);
    expect(images.calls).toHaveLength(0);
    const after = await db.select().from(adMedia).where(eq(adMedia.adSetId, id));
    const ill = (rows: typeof after) => rows.filter((m) => m.kind === "illustration").map((m) => m.storageKey).sort();
    expect(ill(after)).toEqual(ill(before));
    const oldCreative = before.find((m) => m.kind === "creative")!;
    expect(after.some((m) => m.storageKey === oldCreative.storageKey)).toBe(false);
    expect(await storage.exists(oldCreative.storageKey)).toBe(false);
  });

  it("other organizations reach no creative, ZIP or job; an ad without images has no ZIP", async () => {
    await giveDesign();
    const id = await adSet();
    await expect(adZip(db, storage, A, id)).rejects.toMatchObject({ detail: "NO_IMAGES" });
    await renderAdImages(db, { llm: plans(visuals).client, images: fal().client, storage }, A, id, "new");
    const m = (await listAdMedia(db, A, id))[0];
    expect(await adMediaUrl(db, storage, A, m.id, true)).toMatch(/^http/);
    await expect(adMediaUrl(db, storage, B, m.id, false)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(adZip(db, storage, B, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(requestAdImages(db, queue().q, B, id, "new")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listAdMedia(db, B, id)).toEqual([]);
  });

  it("copyForImage takes the first network that has a headline, text and CTA", () => {
    expect(copyForImage({ google_display: { headlines: ["G1", "G2"], descriptions: ["Opis"] }, linkedin: { headline: "Li", intro_text: "Uvod", cta: "Register" } }))
      .toEqual({ headline: "Li", text: "Uvod", cta: "Register" });
    expect(copyForImage({ google_display: { headlines: ["G1"], descriptions: ["Opis"] } })).toEqual({ headline: "G1", text: "Opis", cta: "" });
  });
});
