// What the owner sees first (TASK-056): the month's work and value, cover images, brand cards, feed channels — this
// org only.
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { addChannel, createBrand, getBrandDetail, saveProfile, setBrandArchived } from "../brands/service";
import { postMedia, posts, usageLedger } from "../db/schema";
import { createOrganization } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { brandCards, coverImages, feedChannels, HOURLY_EUR, MINUTES_SAVED, monthValue } from "./showcase";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const profile = { cgp: "CGP", rules: { bannedWords: [], ctaPhrases: [], regexMust: [], regexMustNot: [] }, pillars: [], visual: { colors: {}, imageStyle: "", negativePrompt: "" } };
const NOW = new Date("2026-10-15T10:00:00Z");
const TODAY = "2026-10-15";

let A: OrgContext, B: OrgContext, aib: string, dt: string, brandB: string, igA: string, igB: string;
beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, channels, posts, post_media, usage_ledger cascade`;
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
  igA = (await addChannel(db, A, aib, { platform: "instagram", handle: "@aib", language: "sl", goal: { postsPerDay: 1, weekdays: [1] }, allowedTypes: ["single_image"] })).id;
  await addChannel(db, A, aib, { platform: "x", handle: "@aibx", language: "sl", goal: { postsPerDay: 1, weekdays: [1] }, allowedTypes: ["text"] });
  igB = (await addChannel(db, B, brandB, { platform: "instagram", handle: "@b", language: "sl", goal: { postsPerDay: 1, weekdays: [1] }, allowedTypes: ["single_image"] })).id;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

async function post(ctx: OrgContext, brandId: string, channelId: string, day: string, status = "planned") {
  const { brand } = await getBrandDetail(db, ctx, brandId);
  const id = crypto.randomUUID();
  await forOrg(db, ctx).insert(posts, { id, brandId, channelId, profileVersionId: brand.currentProfileVersionId!, brief: "x", status, format: "image", scheduledOn: day, createdBy: ctx.userId });
  return id;
}
const ledger = (orgId: string, brandId: string | null, action: string, at = NOW, state: "settled" | "reserved" = "settled") =>
  db.insert(usageLedger).values({ id: crypto.randomUUID(), orgId, brandId, provider: "anthropic", model: "m", state, costMicroUsd: 1n, action, createdAt: at });
const media = (orgId: string, postId: string, position: number, archived = false) =>
  db.insert(postMedia).values({ id: crypto.randomUUID(), orgId, postId, kind: "slide", position, storageKey: `k/${crypto.randomUUID()}`, contentType: "image/png", width: 10, height: 10, sizeBytes: 1, archivedAt: archived ? NOW : null }).returning({ id: postMedia.id });

describe("the month's value", () => {
  it("counts settled first-attempt texts and illustrations of this month, this org only; time and value are estimates", async () => {
    await ledger(A.orgId, aib, "text");
    await ledger(A.orgId, aib, "text");
    await ledger(A.orgId, dt, "text");
    await ledger(A.orgId, aib, "illustration");
    await ledger(A.orgId, aib, "assist"); // retries and checks are not work done
    await ledger(A.orgId, aib, "text", NOW, "reserved"); // still running
    await ledger(A.orgId, aib, "text", new Date("2026-09-30T10:00:00Z")); // last month
    await ledger(B.orgId, brandB, "text");
    const v = await monthValue(db, A, NOW);
    const minutes = 3 * MINUTES_SAVED.text + 1 * MINUTES_SAVED.image;
    expect(v).toEqual({ posts: 3, images: 1, brands: 2, minutes, valueEur: Math.round((minutes / 60) * HOURLY_EUR) });
    expect(await monthValue(db, B, NOW)).toMatchObject({ posts: 1, images: 0, brands: 1 });
  });
});

describe("cover images", () => {
  it("slide 1 of the current version per post; posts without images and other orgs' posts are left out", async () => {
    const withImage = await post(A, aib, igA, TODAY);
    const without = await post(A, aib, igA, TODAY);
    const old = await post(A, aib, igA, TODAY);
    const other = await post(B, brandB, igB, TODAY);
    const [cover] = await media(A.orgId, withImage, 0);
    await media(A.orgId, withImage, 1);
    await media(A.orgId, old, 0, true); // replaced by a newer version
    await media(B.orgId, other, 0);
    const map = await coverImages(db, A, [withImage, without, old, other]);
    expect([...map.entries()]).toEqual([[withImage, cover.id]]);
    expect(await coverImages(db, A, [])).toEqual(new Map());
  });
});

describe("brand cards and feed channels", () => {
  it("live brands with channels, upcoming posts (not published or skipped) and the next day; archived brands and other orgs left out", async () => {
    await post(A, aib, igA, "2026-10-14"); // yesterday
    await post(A, aib, igA, "2026-10-18");
    await post(A, aib, igA, "2026-10-16");
    await post(A, aib, igA, "2026-10-17", "published");
    await post(A, aib, igA, "2026-10-17", "skipped");
    const cards = await brandCards(db, A, TODAY);
    expect(cards.map((c) => [c.name, c.platforms, c.upcoming, c.next, c.colors, c.logoId])).toEqual([
      ["AI Builders", ["instagram", "x"], 2, "2026-10-16", [], null],
      ["David Tacer", [], 0, null, [], null],
    ]);
    expect((await feedChannels(db, A)).map((c) => `${c.brandName}·${c.platform}·${c.handle}`)).toEqual(["AI Builders·instagram·@aib", "AI Builders·x·@aibx"]);
    await setBrandArchived(db, A, aib, true);
    expect((await brandCards(db, A, TODAY)).map((c) => c.name)).toEqual(["David Tacer"]);
    expect(await feedChannels(db, A)).toEqual([]);
    expect((await brandCards(db, B, TODAY)).map((c) => c.name)).toEqual(["Drugi"]);
  });
});
