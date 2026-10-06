import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { crossTenantSuite } from "../../../tests/tenancy/harness";
import { brandProfileVersions, brands, channels, orgSettings } from "../db/schema";
import { createOrganization, inviteMember } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import {
  addChannel, createBrand, getBrandDetail, listBrands, listProfileVersions, removeChannel, saveProfile,
  setBrandArchived, updateBrand, updateChannel,
} from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const deps = { mailer, baseURL: "http://localhost:3000" };

let A: OrgContext; // owner of org A
let B: OrgContext; // owner of org B
let editorA: OrgContext;

const profile = {
  cgp: "# Inženirji\nPišemo za inženirje.",
  rules: { bannedWords: ["poceni"], ctaPhrases: ["link v bio"], regexMust: [], regexMustNot: [], hashtagsMax: 3, mustEndWithCta: true },
  pillars: [{ name: "Nasveti", description: "", share: 60 }, { name: "Zgodbe", description: "", share: 40 }],
  visual: { colors: { primary: "#12172b" }, imageStyle: "editorial", negativePrompt: "" },
};
const channel = { platform: "instagram" as const, handle: "@inzenirji", language: "sl" as const, goal: { postsPerDay: 1, weekdays: [1, 3, 5] }, allowedTypes: ["single_image" as const, "carousel" as const], defaultPresetKey: "ig_feed_portrait" };

beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, channels cascade`;
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
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

describe("brands", () => {
  it("owner creates a brand with an empty v1 profile; slug unique per org, reusable in another org", async () => {
    const { id } = await createBrand(db, A, { name: "Inženirji", slug: "inzenirji", languages: ["sl"] });
    const d = await getBrandDetail(db, A, id);
    expect(d.profile).toMatchObject({ version: 1, cgp: "", pillars: [] });
    await expect(createBrand(db, A, { name: "Dup", slug: "inzenirji", languages: ["sl"] })).rejects.toMatchObject({ code: "DUPLICATE" });
    await expect(createBrand(db, B, { name: "Inženirji B", slug: "inzenirji", languages: ["sl"] })).resolves.toBeDefined();
  });

  it("editor can read but not create, change, archive or configure", async () => {
    const { id } = await createBrand(db, A, { name: "Inženirji", slug: "inzenirji", languages: ["sl"] });
    expect((await listBrands(db, editorA)).map((b) => b.id)).toEqual([id]);
    await expect(createBrand(db, editorA, { name: "X", slug: "x1", languages: ["sl"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateBrand(db, editorA, id, { name: "Hacked", slug: "inzenirji", languages: ["sl"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveProfile(db, editorA, id, profile)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(addChannel(db, editorA, id, channel)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setBrandArchived(db, editorA, id, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getBrandDetail(db, A, id)).brand.name).toBe("Inženirji");
  });

  it("brand limit from org_settings.limits is enforced (archived brands do not count)", async () => {
    await db.update(orgSettings).set({ limits: { brands: 1 } }).where(eq(orgSettings.orgId, A.orgId));
    const { id } = await createBrand(db, A, { name: "One", slug: "one", languages: ["sl"] });
    await expect(createBrand(db, A, { name: "Two", slug: "two", languages: ["sl"] })).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    await setBrandArchived(db, A, id, true);
    await expect(createBrand(db, A, { name: "Two", slug: "two", languages: ["sl"] })).resolves.toBeDefined();
    expect((await listBrands(db, A)).map((b) => b.slug)).toEqual(["two"]);
    expect((await listBrands(db, A, { includeArchived: true })).length).toBe(2);
  });

  it("validation: name, slug, languages, website", async () => {
    await expect(createBrand(db, A, { name: "X", slug: "ok", languages: ["sl"] })).rejects.toThrow();
    await expect(createBrand(db, A, { name: "Okay", slug: "Not Ok", languages: ["sl"] })).rejects.toThrow();
    await expect(createBrand(db, A, { name: "Okay", slug: "ok", languages: [] })).rejects.toThrow();
    await expect(createBrand(db, A, { name: "Okay", slug: "ok", languages: ["xx" as never] })).rejects.toThrow();
    await expect(createBrand(db, A, { name: "Okay", slug: "ok", languages: ["sl"], website: "javascript:alert(1)" })).rejects.toThrow();
    await expect(createBrand(db, A, { name: "Okay", slug: "ok", languages: ["sl"], website: "data:text/html,<script>" })).rejects.toThrow();
    await expect(createBrand(db, A, { name: "Okay", slug: "ok", languages: ["sl"], website: "https://inzenirji.si" })).resolves.toBeDefined();
  });
});

describe("profile versions", () => {
  it("each save creates the next version; old versions stay unchanged; current points to the newest", async () => {
    const { id } = await createBrand(db, A, { name: "Inženirji", slug: "inzenirji", languages: ["sl"] });
    expect((await saveProfile(db, A, id, profile)).version).toBe(2);
    expect((await saveProfile(db, A, id, { ...profile, cgp: "v3", note: "tone" })).version).toBe(3);
    const d = await getBrandDetail(db, A, id);
    expect(d.profile).toMatchObject({ version: 3, cgp: "v3" });
    const [v2] = await db.select().from(brandProfileVersions).where(eq(brandProfileVersions.version, 2));
    expect(v2.cgp).toBe(profile.cgp);
    expect((await listProfileVersions(db, A, id)).map((v) => v.version)).toEqual([3, 2, 1]);
  });

  it("10 concurrent saves get versions 2..11 without gaps or duplicates", async () => {
    const { id } = await createBrand(db, A, { name: "Inženirji", slug: "inzenirji", languages: ["sl"] });
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => saveProfile(db, A, id, { ...profile, cgp: `c${i}` })));
    expect(results.map((r) => r.version).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect((await getBrandDetail(db, A, id)).profile!.version).toBe(11);
  });

  it("profile validation: pillar shares ≤ 100, unique names, CTA required with mustEndWithCta, bad regex, bad hex", async () => {
    const { id } = await createBrand(db, A, { name: "Inženirji", slug: "inzenirji", languages: ["sl"] });
    const bad = [
      { ...profile, pillars: [{ name: "A", description: "", share: 60 }, { name: "B", description: "", share: 41 }] },
      { ...profile, pillars: [{ name: "A", description: "", share: 10 }, { name: "a", description: "", share: 10 }] },
      { ...profile, rules: { ...profile.rules, ctaPhrases: [] } },
      { ...profile, rules: { ...profile.rules, regexMust: ["(unclosed"] } },
      { ...profile, visual: { ...profile.visual, colors: { primary: "red" } } },
      { ...profile, cgp: "x".repeat(50_001) },
    ];
    for (const p of bad) await expect(saveProfile(db, A, id, p)).rejects.toThrow();
    expect((await getBrandDetail(db, A, id)).profile!.version).toBe(1);
    await expect(saveProfile(db, A, id, { ...profile, pillars: [{ name: "A", description: "", share: 100 }], cgp: "x".repeat(50_000) })).resolves.toMatchObject({ version: 2 });
  });

  it("archived brands cannot be changed", async () => {
    const { id } = await createBrand(db, A, { name: "Inženirji", slug: "inzenirji", languages: ["sl"] });
    await setBrandArchived(db, A, id, true);
    await expect(saveProfile(db, A, id, profile)).rejects.toMatchObject({ code: "ARCHIVED" });
    await expect(addChannel(db, A, id, channel)).rejects.toMatchObject({ code: "ARCHIVED" });
  });
});

describe("channels", () => {
  it("add, update, remove; preset must match platform and be enabled; duplicates refused", async () => {
    const { id } = await createBrand(db, A, { name: "Inženirji", slug: "inzenirji", languages: ["sl"] });
    const { id: ch } = await addChannel(db, A, id, channel);
    await expect(addChannel(db, A, id, channel)).rejects.toMatchObject({ code: "DUPLICATE" });
    await expect(addChannel(db, A, id, { ...channel, handle: "@x", defaultPresetKey: "li_feed_square" })).rejects.toMatchObject({ code: "PRESET_MISMATCH" });
    await sql`update format_presets set enabled = false where key = 'ig_feed_square'`;
    await expect(addChannel(db, A, id, { ...channel, handle: "@y", defaultPresetKey: "ig_feed_square" })).rejects.toMatchObject({ code: "PRESET_MISMATCH" });
    await sql`update format_presets set enabled = true where key = 'ig_feed_square'`;
    const updated = await updateChannel(db, A, ch, { ...channel, rules: { hashtagsMax: 2 } });
    expect((updated as { rules: unknown }).rules).toEqual({ hashtagsMax: 2 });
    await removeChannel(db, A, ch);
    expect((await getBrandDetail(db, A, id)).channels).toEqual([]);
  });

  it("goal and type validation", async () => {
    const { id } = await createBrand(db, A, { name: "Inženirji", slug: "inzenirji", languages: ["sl"] });
    await expect(addChannel(db, A, id, { ...channel, goal: { postsPerDay: 11, weekdays: [1] } })).rejects.toThrow();
    await expect(addChannel(db, A, id, { ...channel, goal: { postsPerDay: 1, weekdays: [1, 1] } })).rejects.toThrow();
    await expect(addChannel(db, A, id, { ...channel, goal: { postsPerDay: 1, weekdays: [8] } })).rejects.toThrow();
    await expect(addChannel(db, A, id, { ...channel, allowedTypes: [] })).rejects.toThrow();
    await expect(addChannel(db, A, id, { ...channel, goal: { postsPerDay: 10, weekdays: [1, 2, 3, 4, 5, 6, 7] } })).resolves.toBeDefined();
  });
});

describe("cross-tenant: service layer", () => {
  it("org B cannot read, change, version, archive or add channels to org A's brand — A's data unchanged", async () => {
    const { id } = await createBrand(db, A, { name: "Inženirji", slug: "inzenirji", languages: ["sl"] });
    const { id: ch } = await addChannel(db, A, id, channel);
    await expect(getBrandDetail(db, B, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listProfileVersions(db, B, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateBrand(db, B, id, { name: "Hacked", slug: "inzenirji", languages: ["sl"] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(saveProfile(db, B, id, profile)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setBrandArchived(db, B, id, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(addChannel(db, B, id, channel)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateChannel(db, B, ch, { ...channel, handle: "@hacked" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(removeChannel(db, B, ch)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listBrands(db, B)).toEqual([]);
    const d = await getBrandDetail(db, A, id);
    expect(d.brand).toMatchObject({ name: "Inženirji", archivedAt: null });
    expect(d.profile!.version).toBe(1);
    expect(d.channels.map((c) => c.handle)).toEqual(["@inzenirji"]);
  });
});

describe("cross-tenant: data layer", () => {
  const scopes = () => ({ a: forOrg(db, A), b: forOrg(db, B) });
  const seedBrand = async () => (await createBrand(db, A, { name: "Inženirji", slug: `s${Math.random().toString(36).slice(2, 8)}`, languages: ["sl"] })).id;

  crossTenantSuite({
    name: "brands", scopes, seedInA: seedBrand,
    read: (s, id) => s.select(brands, eq(brands.id, id)),
    update: (s, id) => s.update(brands, { name: "Hacked" }, eq(brands.id, id)),
    remove: (s, id) => s.delete(brands, eq(brands.id, id)),
    raw: async (id) => (await db.select().from(brands).where(eq(brands.id, id)))[0],
  });
  crossTenantSuite({
    name: "brand_profile_versions", scopes,
    seedInA: async () => (await getBrandDetail(db, A, await seedBrand())).profile!.id,
    read: (s, id) => s.select(brandProfileVersions, eq(brandProfileVersions.id, id)),
    update: (s, id) => s.update(brandProfileVersions, { cgp: "hacked" }, eq(brandProfileVersions.id, id)),
    remove: (s, id) => s.delete(brandProfileVersions, eq(brandProfileVersions.id, id)),
    raw: async (id) => (await db.select().from(brandProfileVersions).where(eq(brandProfileVersions.id, id)))[0],
  });
  crossTenantSuite({
    name: "channels", scopes,
    seedInA: async () => (await addChannel(db, A, await seedBrand(), channel)).id,
    read: (s, id) => s.select(channels, eq(channels.id, id)),
    update: (s, id) => s.update(channels, { handle: "@hacked" }, eq(channels.id, id)),
    remove: (s, id) => s.delete(channels, eq(channels.id, id)),
    raw: async (id) => (await db.select().from(channels).where(eq(channels.id, id)))[0],
  });
});

describe("channel language follows the brand", () => {
  it("an English-only brand cannot get a Slovenian channel (add or update); English is fine", async () => {
    const { id } = await createBrand(db, A, { name: "AI Builders", slug: "aibuilders", languages: ["en"] });
    await expect(addChannel(db, A, id, { ...channel, language: "sl" })).rejects.toMatchObject({ code: "LANGUAGE_NOT_IN_BRAND" });
    const { id: chId } = await addChannel(db, A, id, { ...channel, language: "en" });
    await expect(updateChannel(db, A, chId, { ...channel, language: "sl" })).rejects.toMatchObject({ code: "LANGUAGE_NOT_IN_BRAND" });
    expect((await getBrandDetail(db, A, id)).channels.map((c) => c.language)).toEqual(["en"]);
  });
});
