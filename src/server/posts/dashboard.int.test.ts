// Dashboard numbers (TASK-020): today's goal per channel, streaks, spend per brand — this org only.
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { addChannel, createBrand, getBrandDetail, saveProfile, setBrandArchived } from "../brands/service";
import { posts, usageLedger } from "../db/schema";
import { createOrganization } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { brandStreaks, costsByBrand, goalOn, todayByChannel } from "./dashboard";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const profile = { cgp: "CGP", rules: { bannedWords: [], ctaPhrases: [], regexMust: [], regexMustNot: [] }, pillars: [], visual: { colors: {}, imageStyle: "", negativePrompt: "" } };
const TODAY = "2026-10-07"; // Wednesday

let A: OrgContext, B: OrgContext, aib: string, dt: string, igA: string, liA: string, igB: string, brandB: string;
beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, channels, posts, usage_ledger cascade`;
  const s = (await session((await signIn("boss@datavallis.com"))!))!;
  const actor = { userId: s.user.id, role: "superadmin" as const };
  const d = { mailer, baseURL: "http://localhost:3000" };
  const a = await createOrganization(db, d, actor, { name: "Org A", slug: "org-a", plan: "pro", ownerEmail: "boss@datavallis.com" });
  const b = await createOrganization(db, d, actor, { name: "Org B", slug: "org-b", plan: "pro", ownerEmail: "b@b.si" });
  const bUser = (await session((await signIn("b@b.si"))!))!.user;
  A = { userId: s.user.id, orgId: a.orgId, orgName: "Org A", role: "owner", plan: "pro" };
  B = { userId: bUser.id, orgId: b.orgId, orgName: "Org B", role: "owner", plan: "pro" };
  aib = (await createBrand(db, A, { name: "AI Builders", slug: "aib", languages: ["sl"] })).id;
  dt = (await createBrand(db, A, { name: "David Tacer", slug: "dt", languages: ["sl"] })).id;
  brandB = (await createBrand(db, B, { name: "Drugi", slug: "drugi", languages: ["sl"] })).id;
  for (const [c, id] of [[A, aib], [A, dt], [B, brandB]] as const) await saveProfile(db, c, id, { ...profile, note: "t" });
  // AI Builders: Instagram 2 a day on Mon–Fri. David: LinkedIn 1 on Mon and Thu only.
  igA = (await addChannel(db, A, aib, { platform: "instagram", handle: "@aib", language: "sl", goal: { postsPerDay: 2, weekdays: [1, 2, 3, 4, 5] }, allowedTypes: ["single_image"] })).id;
  liA = (await addChannel(db, A, dt, { platform: "linkedin", handle: "dt", language: "sl", goal: { postsPerDay: 1, weekdays: [1, 4] }, allowedTypes: ["text"] })).id;
  igB = (await addChannel(db, B, brandB, { platform: "instagram", handle: "@b", language: "sl", goal: { postsPerDay: 1, weekdays: [3] }, allowedTypes: ["single_image"] })).id;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

async function post(ctx: OrgContext, brandId: string, channelId: string, day: string, status: string) {
  const { brand } = await getBrandDetail(db, ctx, brandId);
  await forOrg(db, ctx).insert(posts, { id: crypto.randomUUID(), brandId, channelId, profileVersionId: brand.currentProfileVersionId!, brief: "x", status, format: "image", scheduledOn: day, createdBy: ctx.userId });
}

describe("today per channel", () => {
  it("goal for the weekday, planned (not skipped), ready-or-better, published and missing; channels without a goal today and no posts are left out", async () => {
    await post(A, aib, igA, TODAY, "published");
    await post(A, aib, igA, TODAY, "skipped");
    await post(B, brandB, igB, TODAY, "planned");
    let rows = await todayByChannel(db, A, TODAY);
    expect(rows).toEqual([expect.objectContaining({ brandName: "AI Builders", channelId: igA, goal: 2, planned: 1, done: 1, published: 1, missing: 1 })]);
    await post(A, dt, liA, TODAY, "ready"); // LinkedIn has no goal on Wednesday, but a post today shows it
    await post(A, aib, igA, TODAY, "planned");
    rows = await todayByChannel(db, A, TODAY);
    expect(rows.map((r) => [r.brandName, r.goal, r.planned, r.done, r.missing])).toEqual([["AI Builders", 2, 2, 1, 0], ["David Tacer", 0, 1, 1, 0]]);
    await setBrandArchived(db, A, dt, true);
    expect((await todayByChannel(db, A, TODAY)).map((r) => r.brandName)).toEqual(["AI Builders"]);
    expect(goalOn({ postsPerDay: 3, weekdays: [3] }, TODAY)).toBe(3);
    expect(goalOn({ postsPerDay: 3, weekdays: [1] }, TODAY)).toBe(0);
  });
});

describe("streaks", () => {
  it("consecutive goal days fully published; days without a goal do not break it; today counts once met", async () => {
    // AI Builders needs 2 a day Mon–Fri: Fri 2. 10., Mon 5. 10., Tue 6. 10. met (weekend skipped); Thu 1. 10. not.
    for (const d of ["2026-10-02", "2026-10-05", "2026-10-06"]) { await post(A, aib, igA, d, "published"); await post(A, aib, igA, d, "published"); }
    await post(A, aib, igA, "2026-10-01", "published");
    // Wed 30. 9. met too, but the missed Thursday after it ends the streak: it must not count.
    for (let i = 0; i < 2; i++) await post(A, aib, igA, "2026-09-30", "published");
    // David: LinkedIn on Mon 5. 10. published, Thu 1. 10. missed.
    await post(A, dt, liA, "2026-10-05", "published");
    let s = await brandStreaks(db, A, TODAY);
    expect(s.get(aib)).toBe(3);
    expect(s.get(dt)).toBe(1);
    await post(A, aib, igA, TODAY, "published");
    expect((await brandStreaks(db, A, TODAY)).get(aib)).toBe(3); // today half done: not counted yet
    await post(A, aib, igA, TODAY, "published");
    expect((await brandStreaks(db, A, TODAY)).get(aib)).toBe(4);
    await post(A, aib, igA, "2026-10-06", "approved"); // approved is not published: no change
    s = await brandStreaks(db, B, TODAY);
    expect(s.get(aib)).toBeUndefined(); // other org's brands are not there
  });
});

describe("spend per brand", () => {
  it("this month per brand; imports without a brand under null; earlier months and other orgs left out", async () => {
    const row = (orgId: string, brandId: string | null, cost: bigint, at = new Date("2026-10-05T10:00:00Z")) =>
      db.insert(usageLedger).values({ id: crypto.randomUUID(), orgId, brandId, provider: "anthropic", model: "m", state: "settled", costMicroUsd: cost, createdAt: at });
    await row(A.orgId, aib, 30_000n);
    await row(A.orgId, aib, 12_000n);
    await row(A.orgId, null, 5_000n);
    await row(A.orgId, dt, 99_000n, new Date("2026-09-30T10:00:00Z"));
    await row(B.orgId, brandB, 7_000n);
    const c = await costsByBrand(db, A, new Date("2026-10-07T10:00:00Z"));
    expect(Object.fromEntries([...c.entries()].map(([k, v]) => [k ?? "none", v]))).toEqual({ [aib]: 42_000n, none: 5_000n });
  });
});
