// Brand setup wizard (TASK-055, ADR-081): readiness comes from what is stored (CGP length, logo, past posts, materials,
// pillars and CTAs, colours or style, channels, a ready design); a wizard step saves only its part of the profile.
import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { brandDesigns } from "../db/schema";
import { createS3Storage, s3ConfigFromEnv } from "../files/storage";
import { createOrganization } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { uploadBrandFile } from "./files";
import { brandReadiness, CGP_MIN_CHARS } from "./readiness";
import { addChannel, createBrand, getBrandDetail, listProfileVersions, saveProfile, saveProfilePart } from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const storage = createS3Storage(s3ConfigFromEnv());

let A: OrgContext, brand: string;
beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, channels, brand_sources, brand_assets, brand_designs cascade`;
  const s = (await session((await signIn("boss@datavallis.com"))!))!;
  const a = await createOrganization(db, { mailer, baseURL: "http://x" }, { userId: s.user.id, role: "superadmin" }, { name: "Org A", slug: "org-a", plan: "pro", ownerEmail: "boss@datavallis.com" });
  A = { userId: s.user.id, orgId: a.orgId, orgName: "Org A", role: "owner", plan: "pro" };
  brand = (await createBrand(db, A, { name: "Pekarna", slug: "pekarna", languages: ["sl"] })).id;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

const png = (bg: string) => sharp({ create: { width: 400, height: 400, channels: 3, background: bg } }).png().toBuffer().then((b) => new Uint8Array(b));

describe("brand readiness", () => {
  it("a new brand misses the CGP, logo, channels and design; each stored input completes its step", async () => {
    let r = await brandReadiness(db, A, brand);
    expect(r.missing).toEqual(["cgp", "images", "channels", "design"]);
    expect(r.next).toBe("cgp");
    expect(r.score).toBe(0);

    await saveProfilePart(db, A, brand, { cgp: "Kratko." });
    expect((await brandReadiness(db, A, brand)).steps.cgp).toMatchObject({ state: "missing", detail: { chars: 7, min: CGP_MIN_CHARS } });
    await saveProfilePart(db, A, brand, { cgp: "x".repeat(CGP_MIN_CHARS) });
    await uploadBrandFile(db, storage, A, brand, "logo", { filename: "logo.png", bytes: await png("#ff0000") });
    r = await brandReadiness(db, A, brand);
    expect(r.steps.images.state).toBe("recommended"); // a logo, but no past posts yet
    expect(r.missing).toEqual(["channels", "design"]);
    for (const c of ["#111111", "#222222", "#333333"]) await uploadBrandFile(db, storage, A, brand, "source", { filename: `objava-${c.slice(1)}.png`, bytes: await png(c) });
    await uploadBrandFile(db, storage, A, brand, "source", { filename: "cenik.md", bytes: new TextEncoder().encode("# Cenik\nKruh 3 €") });
    await saveProfilePart(db, A, brand, { pillars: [{ name: "Kruh", share: 60, description: "" }, { name: "Prazniki", share: 40, description: "" }], rules: { ctaPhrases: ["Pridite"] } });
    await saveProfilePart(db, A, brand, { visual: { colors: { primary: "#e85d04", accent: "#1b4332" }, imageStyle: "", negativePrompt: "" } });
    await addChannel(db, A, brand, { platform: "instagram", handle: "@pekarna", language: "sl", goal: { postsPerDay: 1, weekdays: [1] }, allowedTypes: ["single_image"] });
    r = await brandReadiness(db, A, brand);
    expect(Object.fromEntries(Object.entries(r.steps).map(([k, v]) => [k, v.state]))).toEqual({
      cgp: "done", images: "done", materials: "done", rules: "done", visual: "done", channels: "done", design: "missing",
    });
    expect(r.next).toBe("design");
    await forOrg(db, A).insert(brandDesigns, { id: crypto.randomUUID(), brandId: brand, version: 1, status: "generating", brief: "", createdBy: A.userId });
    expect((await brandReadiness(db, A, brand)).designWorking).toBe(true);
    await sql`update brand_designs set status = 'ready'`;
    r = await brandReadiness(db, A, brand);
    expect(r).toMatchObject({ score: 100, missing: [], next: "done" });
  });

  it("a wizard step keeps the rest of the profile and makes one new version", async () => {
    await saveProfile(db, A, brand, {
      cgp: "Ton: topel.", pillars: [{ name: "Kruh", share: 100, description: "" }],
      rules: { bannedWords: ["poceni"], ctaPhrases: ["Pridite"], regexMust: [], regexMustNot: [], hashtagsMax: 5 },
      visual: { colors: { primary: "#e85d04" }, imageStyle: "Topla fotografija", negativePrompt: "ljudje" },
    });
    await saveProfilePart(db, A, brand, { rules: { ctaPhrases: ["Naročite"], hashtagsMax: undefined }, note: "čarovnik" });
    const { profile } = await getBrandDetail(db, A, brand);
    expect(profile).toMatchObject({
      cgp: "Ton: topel.", pillars: [{ name: "Kruh", share: 100 }], visual: { colors: { primary: "#e85d04" }, imageStyle: "Topla fotografija", negativePrompt: "ljudje" },
      rules: { bannedWords: ["poceni"], ctaPhrases: ["Naročite"] },
    });
    expect(profile!.rules.hashtagsMax).toBeUndefined();
    expect((await listProfileVersions(db, A, brand)).map((v) => v.version)).toEqual([3, 2, 1]);
    await expect(saveProfilePart(db, { ...A, role: "editor" }, brand, { cgp: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
