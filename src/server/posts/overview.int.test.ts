// Dashboard numbers and the org-wide posts table (TASK-011): filters, paging, and never another org's rows.
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { addChannel, createBrand, saveProfile } from "../brands/service";
import { createS3Storage, s3ConfigFromEnv } from "../files/storage";
import { createFakeLlm } from "../llm/fake";
import { createOrganization } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { generatePost, setPostStatus } from "./generate";
import { brandStats, listOrgPosts, orgOverview, PAGE_SIZE, parsePostFilters } from "./overview";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const storage = createS3Storage(s3ConfigFromEnv());
const profile = { cgp: "CGP", rules: { bannedWords: [], ctaPhrases: [], regexMust: [], regexMustNot: [] }, pillars: [], visual: { colors: {}, imageStyle: "", negativePrompt: "" } };
const out = (caption: string) => ({ input: { caption, hashtags: [], topic_summary: "t" } });

let A: OrgContext, B: OrgContext, igA: string, liA: string, brandA: string, brandA2: string, brandB: string, igB: string;
beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, channels, brand_sources, brand_assets, posts, usage_ledger cascade`;
  const s = (await session((await signIn("boss@datavallis.com"))!))!;
  const actor = { userId: s.user.id, role: "superadmin" as const };
  const d = { mailer, baseURL: "http://localhost:3000" };
  const a = await createOrganization(db, d, actor, { name: "Org A", slug: "org-a", plan: "pro", ownerEmail: "boss@datavallis.com" });
  const b = await createOrganization(db, d, actor, { name: "Org B", slug: "org-b", plan: "pro", ownerEmail: "b@b.si" });
  const bUser = (await session((await signIn("b@b.si"))!))!.user;
  A = { userId: s.user.id, orgId: a.orgId, orgName: "Org A", role: "owner", plan: "pro" };
  B = { userId: bUser.id, orgId: b.orgId, orgName: "Org B", role: "owner", plan: "pro" };
  const chan = (platform: "instagram" | "linkedin", handle: string) => ({ platform, handle, language: "sl" as const, goal: { postsPerDay: 1, weekdays: [1] }, allowedTypes: ["text" as const] });
  brandA = (await createBrand(db, A, { name: "Inženirji", slug: "inzenirji", languages: ["sl"] })).id;
  brandA2 = (await createBrand(db, A, { name: "AI Builders", slug: "aib", languages: ["sl"] })).id;
  brandB = (await createBrand(db, B, { name: "Cherr", slug: "cherr", languages: ["sl"] })).id;
  for (const [ctx, id] of [[A, brandA], [A, brandA2], [B, brandB]] as const) await saveProfile(db, ctx, id, { ...profile, note: "t" });
  igA = (await addChannel(db, A, brandA, chan("instagram", "@inz"))).id;
  liA = (await addChannel(db, A, brandA2, chan("linkedin", "david"))).id;
  igB = (await addChannel(db, B, brandB, chan("instagram", "@cherr"))).id;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

async function make(ctx: OrgContext, brandId: string, channelId: string, caption: string, brief = "naročilo") {
  const llm = createFakeLlm([out(caption)]);
  return generatePost(db, { llm: llm.client, storage }, ctx, { brandId, channelId, brief });
}

describe("listOrgPosts", () => {
  it("only this org; brand and channel names; search in caption and brief (case-insensitive, % and _ literal); filters combine", async () => {
    const p1 = await make(A, brandA, igA, "Jesenski TEČAJ je tu");
    await make(A, brandA2, liA, "Vibe coding 100%", "o kodiranju");
    await make(B, brandB, igB, "Every euro on the record");
    const all = await listOrgPosts(db, A);
    expect(all.total).toBe(2);
    expect(all.rows.map((r) => r.brandName).sort()).toEqual(["AI Builders", "Inženirji"]);
    expect(all.rows.find((r) => r.id === p1)).toMatchObject({ platform: "instagram", handle: "@inz", status: "ready" });
    expect((await listOrgPosts(db, A, { q: "tečaj" })).rows.map((r) => r.id)).toEqual([p1]);
    expect((await listOrgPosts(db, A, { q: "KODIRANJU" })).total).toBe(1); // brief
    expect((await listOrgPosts(db, A, { q: "100%" })).total).toBe(1);
    expect((await listOrgPosts(db, A, { q: "0_%" })).total).toBe(0); // wildcards escaped
    expect((await listOrgPosts(db, A, { platform: "linkedin" })).rows.map((r) => r.brandName)).toEqual(["AI Builders"]);
    expect((await listOrgPosts(db, A, { brandId: brandA, platform: "linkedin" })).total).toBe(0);
    expect((await listOrgPosts(db, A, { status: "published" })).total).toBe(0);
    expect((await listOrgPosts(db, A, { q: "euro" })).total).toBe(0); // org B's caption
    expect((await listOrgPosts(db, A, { brandId: brandB })).total).toBe(0); // org B's brand id
  });

  it("pages of PAGE_SIZE, newest first", async () => {
    for (let i = 0; i < PAGE_SIZE + 2; i++) await make(A, brandA, igA, `Objava ${i}`);
    const p1 = await listOrgPosts(db, A, { page: 1 });
    const p2 = await listOrgPosts(db, A, { page: 2 });
    expect([p1.rows.length, p2.rows.length, p1.pages, p1.total]).toEqual([PAGE_SIZE, 2, 2, PAGE_SIZE + 2]);
    expect(p2.rows.at(-1)!.caption).toBe("Objava 0");
  });
});

describe("parsePostFilters", () => {
  it("drops unknown statuses, bad pages and arrays; trims", () => {
    expect(parsePostFilters({ q: "  a ", status: "nope", page: "-3", brand: ["x", "y"] })).toEqual({ q: "a", brandId: undefined, status: undefined, platform: undefined, page: 1 });
    expect(parsePostFilters({ status: "needs_review", page: "2" })).toMatchObject({ status: "needs_review", page: 2 });
  });
});

describe("orgOverview and brandStats", () => {
  it("counts this org only: by status, published this month, brands, spend vs cap; per brand channels/posts/waiting", async () => {
    const a = await make(A, brandA, igA, "Prva");
    await make(A, brandA, igA, "Druga");
    await make(B, brandB, igB, "Tuja");
    await setPostStatus(db, A, a, "approved");
    await setPostStatus(db, A, a, "published");
    const o = await orgOverview(db, A);
    expect(o).toMatchObject({ ready: 1, needsReview: 0, approved: 0, publishedThisMonth: 1, brands: 2, capMicroUsd: 50_000_000n });
    expect(o.spentMicroUsd).toBeGreaterThan(0n);
    const s = await brandStats(db, A);
    expect(s.get(brandA)).toMatchObject({ channels: 1, posts: 2, waiting: 1 });
    expect(s.get(brandA2)).toMatchObject({ channels: 1, posts: 0, waiting: 0 });
    expect(s.has(brandB)).toBe(false);
  });
});
