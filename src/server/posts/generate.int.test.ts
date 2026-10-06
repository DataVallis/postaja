import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { pdf } from "../../../tests/fixtures/files";
import { crossTenantSuite } from "../../../tests/tenancy/harness";
import { uploadBrandFile } from "../brands/files";
import { addChannel, createBrand, saveProfile, setBrandArchived } from "../brands/service";
import { orgSettings, posts, usageLedger } from "../db/schema";
import { createS3Storage, s3ConfigFromEnv } from "../files/storage";
import { createFakeLlm } from "../llm/fake";
import { reserve, SpendCapError } from "../llm/spend";
import { LlmError } from "../llm/types";
import { createOrganization, inviteMember } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { editPost, generatePost, getPost, listPosts, setPostStatus } from "./generate";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const deps0 = { mailer, baseURL: "http://localhost:3000" };
const storage = createS3Storage(s3ConfigFromEnv());

let A: OrgContext, B: OrgContext, editorA: OrgContext;
let brandA: string, igA: string, xA: string, brandB: string;
const profile = {
  cgp: "Pišemo strokovno in toplo.",
  rules: { bannedWords: ["poceni"], ctaPhrases: ["link v bio"], regexMust: [], regexMustNot: [], mustEndWithCta: true },
  pillars: [], visual: { colors: {}, imageStyle: "", negativePrompt: "" },
};
const goodIg = { caption: "Nov tečaj je tu. Link v bio", hashtags: ["inženirji", "tečaj"], topic_summary: "Launch of the new course." };
const ledger = () => sql`select state, cost_micro_usd::text as cost, post_id from usage_ledger order by created_at`;

beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, channels, brand_sources, brand_assets, posts, usage_ledger cascade`;
  const s = (await session((await signIn("boss@datavallis.com"))!))!;
  const actor = { userId: s.user.id, role: "superadmin" as const };
  const a = await createOrganization(db, deps0, actor, { name: "Org A", slug: "org-a", plan: "pro", ownerEmail: "boss@datavallis.com" });
  const b = await createOrganization(db, deps0, actor, { name: "Org B", slug: "org-b", plan: "pro", ownerEmail: "b@b.si" });
  const bUser = (await session((await signIn("b@b.si"))!))!.user;
  await inviteMember(db, deps0, actor, a.orgId, { email: "ed@a.si", role: "editor" });
  const ed = (await session((await signIn("ed@a.si"))!))!.user;
  A = { userId: s.user.id, orgId: a.orgId, orgName: "Org A", role: "owner", plan: "pro" };
  B = { userId: bUser.id, orgId: b.orgId, orgName: "Org B", role: "owner", plan: "pro" };
  editorA = { userId: ed.id, orgId: a.orgId, orgName: "Org A", role: "editor", plan: "pro" };
  brandA = (await createBrand(db, A, { name: "Inženirji", slug: "inzenirji", languages: ["sl"] })).id;
  await saveProfile(db, A, brandA, { ...profile, note: "test" });
  igA = (await addChannel(db, A, brandA, { platform: "instagram", handle: "@inzenirji", language: "sl", goal: { postsPerDay: 1, weekdays: [1] }, allowedTypes: ["text"] })).id;
  xA = (await addChannel(db, A, brandA, { platform: "x", handle: "@inz", language: "sl", goal: { postsPerDay: 1, weekdays: [1] }, allowedTypes: ["text"] })).id;
  brandB = (await createBrand(db, B, { name: "Cherr", slug: "cherr", languages: ["en"] })).id;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

describe("generatePost", () => {
  it("valid answer passing every rule → ready; content composed; one settled ledger row with the exact cost", async () => {
    const llm = createFakeLlm([{ input: goodIg, usage: { inputTokens: 1000, outputTokens: 200 } }]);
    const id = await generatePost(db, { llm: llm.client, storage }, A, { brandId: brandA, channelId: igA, brief: "Napovej nov tečaj" });
    const p = await getPost(db, A, id);
    expect(p).toMatchObject({ status: "ready", fixAttempts: 0, model: "claude-sonnet-5-5", topicSummary: "Launch of the new course.", ruleFailures: [] });
    expect(p.content).toEqual({ caption: "Nov tečaj je tu. Link v bio\n\n#inženirji #tečaj", hashtags: ["#inženirji", "#tečaj"] });
    expect(await ledger()).toEqual([{ state: "settled", cost: "4000", post_id: id }]); // 1000×2 + 200×10 µ$
    expect(llm.requests[0]).toMatchObject({ model: "claude-sonnet-5-5", maxTokens: 2000 });
    expect(llm.requests[0].system[1].text).toContain("Pišemo strokovno in toplo.");
  });

  it("rule failure → one automatic fix with the violations → ready (2 calls, 2 ledger rows)", async () => {
    const llm = createFakeLlm([{ input: { ...goodIg, caption: "Poceni tečaj!" } }, { input: goodIg }]);
    const id = await generatePost(db, { llm: llm.client, storage }, A, { brandId: brandA, channelId: igA, brief: "Tečaj" });
    expect(await getPost(db, A, id)).toMatchObject({ status: "ready", fixAttempts: 1 });
    expect(llm.requests[1].user).toContain("- banned_word: poceni");
    expect(llm.requests[1].user).toContain("- missing_cta:");
    expect((await ledger()).map((r) => r.state)).toEqual(["settled", "settled"]);
  });

  it("still failing after the fix → needs_review with the failures shown", async () => {
    const bad = { ...goodIg, caption: "Poceni tečaj! Link v bio" };
    const llm = createFakeLlm([{ input: bad }, { input: bad }]);
    const id = await generatePost(db, { llm: llm.client, storage }, A, { brandId: brandA, channelId: igA, brief: "Tečaj" });
    const p = await getPost(db, A, id);
    expect(p.status).toBe("needs_review");
    expect(p.ruleFailures).toEqual([{ code: "banned_word", actual: "poceni", limit: "" }]);
    expect(llm.requests).toHaveLength(2); // never a third call
  });

  it("schema-invalid answer twice → failed INVALID_OUTPUT; provider error → failed, reservation released", async () => {
    const llm = createFakeLlm([{ input: { caption: "" } }, { input: { nope: 1 } }]);
    const id = await generatePost(db, { llm: llm.client, storage }, A, { brandId: brandA, channelId: igA, brief: "Tečaj" });
    expect(await getPost(db, A, id)).toMatchObject({ status: "failed", error: "INVALID_OUTPUT" });
    expect(llm.requests[1].user).toContain("did not match the submit_post schema");
    await sql`truncate usage_ledger`;
    const down = createFakeLlm([{ error: new LlmError("PROVIDER", "anthropic 529") }]);
    const id2 = await generatePost(db, { llm: down.client, storage }, A, { brandId: brandA, channelId: igA, brief: "Tečaj" });
    expect(await getPost(db, A, id2)).toMatchObject({ status: "failed", error: "PROVIDER" });
    expect(await ledger()).toEqual([]);
  });

  it("X channel: thread schema, per-part limits; hashtags land on the last part", async () => {
    const llm = createFakeLlm([{ input: { parts: ["Prvi del", "Drugi del. Link v bio"], hashtags: ["ai"], topic_summary: "t" } }]);
    const id = await generatePost(db, { llm: llm.client, storage }, A, { brandId: brandA, channelId: xA, brief: "Nit o AI" });
    const p = await getPost(db, A, id);
    expect(p.status).toBe("ready");
    expect(p.content!.parts).toEqual(["Prvi del", "Drugi del. Link v bio\n\n#ai"]);
    expect(llm.requests[0].tool.inputSchema.required).toEqual(["parts", "hashtags", "topic_summary"]);
    expect(llm.requests[0].system[2].text).toContain("each at most 280 characters (X counting");
  });

  it("text materials of this brand are in the prompt; PDFs, other brands and other orgs are not", async () => {
    await uploadBrandFile(db, storage, A, brandA, "source", { filename: "cenik.csv", bytes: new TextEncoder().encode("Tečaj;99 €") });
    await uploadBrandFile(db, storage, A, brandA, "source", { filename: "brosura.pdf", bytes: pdf("brochure") });
    await uploadBrandFile(db, storage, B, brandB, "source", { filename: "tajno.txt", bytes: new TextEncoder().encode("SECRET-OF-B") });
    const other = (await createBrand(db, A, { name: "Drugi", slug: "drugi", languages: ["sl"] })).id;
    await uploadBrandFile(db, storage, A, other, "source", { filename: "drugi.txt", bytes: new TextEncoder().encode("OTHER-BRAND") });
    const llm = createFakeLlm([{ input: goodIg }]);
    await generatePost(db, { llm: llm.client, storage }, A, { brandId: brandA, channelId: igA, brief: "Cene" });
    const block = llm.requests[0].system[1].text;
    expect(block).toContain('<material name="cenik.csv">\nTečaj;99 €\n</material>');
    expect(block).not.toContain("brosura.pdf");
    expect(block).not.toContain("SECRET-OF-B");
    expect(block).not.toContain("OTHER-BRAND");
  });

  it("editors generate too; another org gets NOT_FOUND; archived brands refuse; bad brief refused", async () => {
    const llm = createFakeLlm([{ input: goodIg }]);
    await expect(generatePost(db, { llm: llm.client, storage }, editorA, { brandId: brandA, channelId: igA, brief: "Tečaj" })).resolves.toBeTruthy();
    await expect(generatePost(db, { llm: llm.client, storage }, B, { brandId: brandA, channelId: igA, brief: "Tečaj" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(generatePost(db, { llm: llm.client, storage }, A, { brandId: brandA, channelId: igA, brief: "ab" })).rejects.toThrow();
    await setBrandArchived(db, A, brandA, true);
    await expect(generatePost(db, { llm: llm.client, storage }, A, { brandId: brandA, channelId: igA, brief: "Tečaj" })).rejects.toMatchObject({ code: "ARCHIVED" });
    expect(llm.requests).toHaveLength(1);
  });
});

describe("spend cap", () => {
  it("cap too small → failed SPEND_CAP and the model is never called", async () => {
    await db.update(orgSettings).set({ spendCapMicroUsd: 1000n }).where(eq(orgSettings.orgId, A.orgId));
    const llm = createFakeLlm([{ input: goodIg }]);
    const id = await generatePost(db, { llm: llm.client, storage }, A, { brandId: brandA, channelId: igA, brief: "Tečaj" });
    expect(await getPost(db, A, id)).toMatchObject({ status: "failed", error: "SPEND_CAP" });
    expect(llm.requests).toHaveLength(0);
  });

  it("exact boundary: used + estimate = cap passes, one more is refused; last month does not count", async () => {
    await db.update(orgSettings).set({ spendCapMicroUsd: 10_000n }).where(eq(orgSettings.orgId, A.orgId));
    const now = new Date("2026-10-15T12:00:00Z");
    await sql`insert into usage_ledger (id, org_id, provider, model, state, cost_micro_usd, created_at) values ('old', ${A.orgId}, 'anthropic', 'm', 'settled', 9999999, '2026-09-30T23:59:59Z')`;
    const r = { orgId: A.orgId, brandId: null, postId: null, provider: "anthropic", model: "m", now };
    await reserve(db, { ...r, estimate: 6_000n });
    await expect(reserve(db, { ...r, estimate: 4_001n })).rejects.toBeInstanceOf(SpendCapError);
    await expect(reserve(db, { ...r, estimate: 4_000n })).resolves.toBeTruthy();
    await expect(reserve(db, { ...r, estimate: 1n })).rejects.toBeInstanceOf(SpendCapError);
  });

  it("parallel reservations cannot jointly exceed the cap (row lock): of 5 × 3000 under a 10000 cap exactly 3 pass", async () => {
    await db.update(orgSettings).set({ spendCapMicroUsd: 10_000n }).where(eq(orgSettings.orgId, A.orgId));
    const r = { orgId: A.orgId, brandId: null, postId: null, provider: "anthropic", model: "m", estimate: 3_000n };
    const res = await Promise.allSettled(Array.from({ length: 5 }, () => reserve(db, r)));
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(3);
    expect((await sql`select sum(cost_micro_usd)::int s from usage_ledger`)[0].s).toBe(9000);
  });
});

describe("edit and status", () => {
  it("hand edit is re-checked: breaking a rule → needs_review, fixing it → ready", async () => {
    const id = await generatePost(db, { llm: createFakeLlm([{ input: goodIg }]).client, storage }, A, { brandId: brandA, channelId: igA, brief: "Tečaj" });
    expect(await editPost(db, A, id, { caption: "Poceni! Link v bio" })).toEqual([{ code: "banned_word", actual: "poceni", limit: "" }]);
    expect((await getPost(db, A, id)).status).toBe("needs_review");
    expect(await editPost(db, editorA, id, { caption: "Dober tečaj. Link v bio #a" })).toEqual([]);
    expect(await getPost(db, A, id)).toMatchObject({ status: "ready", content: { caption: "Dober tečaj. Link v bio #a" } });
    await expect(editPost(db, B, id, { caption: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("transitions: ready → approved → published; no jump from failed to published", async () => {
    const id = await generatePost(db, { llm: createFakeLlm([{ input: goodIg }]).client, storage }, A, { brandId: brandA, channelId: igA, brief: "Tečaj" });
    await setPostStatus(db, A, id, "approved");
    await setPostStatus(db, A, id, "published");
    expect((await getPost(db, A, id)).status).toBe("published");
    await expect(setPostStatus(db, A, id, "generating")).rejects.toMatchObject({ code: "BAD_STATE" });
    const failed = await generatePost(db, { llm: createFakeLlm([{ error: new LlmError("PROVIDER") }]).client, storage }, A, { brandId: brandA, channelId: igA, brief: "Tečaj" });
    await expect(setPostStatus(db, A, failed, "published")).rejects.toMatchObject({ code: "BAD_STATE" });
    await expect(setPostStatus(db, B, id, "skipped")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listPosts(db, A, brandA)).map((p) => p.id)).toEqual([failed, id]);
    expect(await listPosts(db, B, brandA)).toEqual([]);
  });
});

describe("cross-tenant harness", () => {
  crossTenantSuite({
    name: "posts",
    scopes: () => ({ a: forOrg(db, A), b: forOrg(db, B) }),
    seedInA: async (a) => {
      const id = crypto.randomUUID();
      const [v] = await sql`select current_profile_version_id v from brands where id = ${brandA}`;
      await a.insert(posts, { id, brandId: brandA, channelId: igA, profileVersionId: v.v, brief: "x", status: "ready", createdBy: A.userId });
      return id;
    },
    read: (s, id) => s.select(posts, eq(posts.id, id)),
    update: (s, id) => s.update(posts, { brief: "hacked" }, eq(posts.id, id)),
    remove: (s, id) => s.delete(posts, eq(posts.id, id)),
    raw: async (id) => (await db.select().from(posts).where(eq(posts.id, id)))[0],
  });
  it("usage_ledger rows carry the org that spent", async () => {
    await generatePost(db, { llm: createFakeLlm([{ input: goodIg }]).client, storage }, A, { brandId: brandA, channelId: igA, brief: "Tečaj" });
    expect((await db.select().from(usageLedger)).map((r) => r.orgId)).toEqual([A.orgId]);
  });
});
