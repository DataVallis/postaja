// The plan views (TASK-013): calendar range, unscheduled, history, rescheduling — and never another org's posts.
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { addChannel, createBrand, saveProfile } from "../brands/service";
import { createS3Storage, s3ConfigFromEnv } from "../files/storage";
import { createFakeLlm } from "../llm/fake";
import { createOrganization } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { CALENDAR_DEFAULT_STATUSES, calendarPosts, historyPosts, reschedulePost, unscheduledPosts } from "./calendar";
import { generatePost, setPostStatus } from "./generate";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const storage = createS3Storage(s3ConfigFromEnv());
const profile = { cgp: "CGP", rules: { bannedWords: [], ctaPhrases: [], regexMust: [], regexMustNot: [] }, pillars: [], visual: { colors: {}, imageStyle: "", negativePrompt: "" } };
const chan = (platform: "instagram" | "linkedin", handle: string) => ({ platform, handle, language: "sl" as const, goal: { postsPerDay: 1, weekdays: [1] }, allowedTypes: ["text" as const] });

let A: OrgContext, B: OrgContext, brandA: string, brandA2: string, igA: string, liA: string, igB: string, brandB: string;
beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, channels, brand_sources, brand_assets, posts, usage_ledger, plan_imports cascade`;
  const s = (await session((await signIn("boss@datavallis.com"))!))!;
  const actor = { userId: s.user.id, role: "superadmin" as const };
  const d = { mailer, baseURL: "http://localhost:3000" };
  const a = await createOrganization(db, d, actor, { name: "Org A", slug: "org-a", plan: "pro", ownerEmail: "boss@datavallis.com" });
  const b = await createOrganization(db, d, actor, { name: "Org B", slug: "org-b", plan: "pro", ownerEmail: "b@b.si" });
  const bUser = (await session((await signIn("b@b.si"))!))!.user;
  A = { userId: s.user.id, orgId: a.orgId, orgName: "Org A", role: "owner", plan: "pro" };
  B = { userId: bUser.id, orgId: b.orgId, orgName: "Org B", role: "owner", plan: "pro" };
  brandA = (await createBrand(db, A, { name: "Inženirji", slug: "inz", languages: ["sl"] })).id;
  brandA2 = (await createBrand(db, A, { name: "AI Builders", slug: "aib", languages: ["sl"] })).id;
  brandB = (await createBrand(db, B, { name: "Cherr", slug: "cherr", languages: ["sl"] })).id;
  for (const [c, id] of [[A, brandA], [A, brandA2], [B, brandB]] as const) await saveProfile(db, c, id, { ...profile, note: "t" });
  igA = (await addChannel(db, A, brandA, chan("instagram", "@inz"))).id;
  liA = (await addChannel(db, A, brandA2, chan("linkedin", "david"))).id;
  igB = (await addChannel(db, B, brandB, chan("instagram", "@cherr"))).id;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

async function make(ctx: OrgContext, brandId: string, channelId: string, caption: string, day: string | null, time: string | null = null) {
  const id = await generatePost(db, { llm: createFakeLlm([{ input: { caption, hashtags: [], topic_summary: "t" } }]).client, storage }, ctx, { brandId, channelId, brief: caption });
  await sql`update posts set scheduled_on = ${day}, scheduled_time = ${time} where id = ${id}`;
  return id;
}

describe("calendarPosts", () => {
  it("inclusive range in day and time order (no time last); other org, skipped and out-of-range left out; filters", async () => {
    const a = await make(A, brandA, igA, "Jutro", "2026-10-06", "08:30");
    const b = await make(A, brandA2, liA, "Brez ure", "2026-10-06");
    const c = await make(A, brandA, igA, "Zgodaj", "2026-10-06", "07:00");
    const d = await make(A, brandA, igA, "Konec meseca", "2026-10-31");
    await make(A, brandA, igA, "Prej", "2026-09-27");
    const skipped = await make(A, brandA, igA, "Preskočena", "2026-10-07");
    await setPostStatus(db, A, skipped, "skipped");
    await make(B, brandB, igB, "Tuja", "2026-10-06");
    expect((await calendarPosts(db, A, "2026-09-28", "2026-10-31")).map((p) => p.id)).toEqual([c, a, b, d]);
    expect((await calendarPosts(db, A, "2026-10-06", "2026-10-06", { brandId: brandA2 })).map((p) => p.id)).toEqual([b]);
    expect((await calendarPosts(db, A, "2026-10-01", "2026-10-31", { platform: "instagram" })).map((p) => p.brandName)).toEqual(["Inženirji", "Inženirji", "Inženirji"]);
    expect((await calendarPosts(db, A, "2026-10-01", "2026-10-31", { status: "skipped" })).map((p) => p.id)).toEqual([skipped]);
    expect(await calendarPosts(db, A, "2026-10-01", "2026-10-31", { brandId: brandB })).toEqual([]);
    await expect(calendarPosts(db, A, "2026-10-31", "2026-10-01")).rejects.toMatchObject({ code: "BAD_STATE" });
    await expect(calendarPosts(db, A, "2026-02-30", "2026-03-01")).rejects.toMatchObject({ code: "BAD_STATE" });
  });

  it("shows only the chosen statuses: by default no published posts (owner), or exactly what is ticked", async () => {
    const todo = await make(A, brandA, igA, "Za narediti", "2026-10-06");
    const done = await make(A, brandA, igA, "Objavljena", "2026-10-07");
    await setPostStatus(db, A, done, "approved");
    await setPostStatus(db, A, done, "published");
    const range = ["2026-10-01", "2026-10-31"] as const;
    expect((await calendarPosts(db, A, ...range, { statuses: CALENDAR_DEFAULT_STATUSES })).map((p) => p.id)).toEqual([todo]);
    expect((await calendarPosts(db, A, ...range, { statuses: ["published"] })).map((p) => p.id)).toEqual([done]);
    expect((await calendarPosts(db, A, ...range, { statuses: [] }))).toEqual([]);
    expect((await calendarPosts(db, A, ...range)).map((p) => p.id)).toEqual([todo, done]); // the dashboard's "Danes" keeps all
  });
});

describe("unscheduled and history", () => {
  it("unscheduled excludes published and skipped; history is newest publication first, this org only", async () => {
    const u = await make(A, brandA, igA, "Brez termina", null);
    const p1 = await make(A, brandA, igA, "Objavljena 1", "2026-09-01");
    const p2 = await make(A, brandA2, liA, "Objavljena 2", null);
    for (const id of [p1, p2]) { await setPostStatus(db, A, id, "approved"); await setPostStatus(db, A, id, "published"); }
    await sql`update posts set published_at = '2026-09-01T10:00:00Z' where id = ${p1}`;
    await sql`update posts set published_at = '2026-09-05T10:00:00Z' where id = ${p2}`;
    const bp = await make(B, brandB, igB, "Tuja objavljena", null);
    await setPostStatus(db, B, bp, "approved"); await setPostStatus(db, B, bp, "published");
    expect((await unscheduledPosts(db, A)).rows.map((r) => r.id)).toEqual([u]);
    const h = await historyPosts(db, A);
    expect([h.total, ...h.rows.map((r) => r.id)]).toEqual([2, p2, p1]);
    expect((await historyPosts(db, A, { platform: "linkedin" })).rows.map((r) => r.id)).toEqual([p2]);
  });
});

describe("reschedulePost", () => {
  it("moves, sets time, clears; refuses bad dates, time without date, published posts and other orgs", async () => {
    const id = await make(A, brandA, igA, "Premik", "2026-10-06", "08:30");
    await reschedulePost(db, A, id, { date: "2026-10-09", time: "18:00" });
    expect(await sql`select scheduled_on::text d, scheduled_time t from posts where id = ${id}`).toEqual([{ d: "2026-10-09", t: "18:00" }]);
    await reschedulePost(db, A, id, { date: null, time: null });
    expect(await sql`select scheduled_on d from posts where id = ${id}`).toEqual([{ d: null }]);
    await expect(reschedulePost(db, A, id, { date: "2026-02-30", time: null })).rejects.toThrow();
    await expect(reschedulePost(db, A, id, { date: "2026-10-09", time: "24:00" })).rejects.toThrow();
    await expect(reschedulePost(db, A, id, { date: null, time: "10:00" })).rejects.toThrow();
    await expect(reschedulePost(db, B, id, { date: "2026-10-10", time: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await sql`select scheduled_on d from posts where id = ${id}`).toEqual([{ d: null }]);
    await setPostStatus(db, A, id, "approved"); await setPostStatus(db, A, id, "published");
    await expect(reschedulePost(db, A, id, { date: "2026-10-10", time: null })).rejects.toMatchObject({ code: "BAD_STATE" });
  });
});
