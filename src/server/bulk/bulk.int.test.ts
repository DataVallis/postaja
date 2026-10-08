// Bulk creation (TASK-014): which posts a run takes, that each post is written once, cap, cancel, access, tenancy,
// and the real pg-boss path end to end.
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { addChannel, createBrand, getBrandDetail, saveProfile, setBrandArchived } from "../brands/service";
import { orgSettings, posts } from "../db/schema";
import { createS3Storage, s3ConfigFromEnv } from "../files/storage";
import type { LlmClient, StructuredRequest } from "../llm/types";
import { createOrganization, inviteMember } from "../orgs/service";
import { planBrief } from "../posts/generate";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { bossQueue, getBoss, stopBoss } from "../jobs/boss";
import { cardDesign } from "../../../tests/fixtures/design";
import { brandDesigns, brands as brandsTable, brandSources, modelRegistry, usageLedger } from "../db/schema";
import { designSpecSchema, needsIllustration } from "../design/spec";
import { estimateBulk, imagesFor } from "./estimate";
import { BULK_MAX, bulkCandidates, cancelBulk, listBulkRuns, POST_TEXT_QUEUE, runBulkItem, startBulk, type JobQueue, type PostTextJob } from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const storage = createS3Storage(s3ConfigFromEnv());
const profile = { cgp: "CGP", rules: { bannedWords: [], ctaPhrases: [], regexMust: [], regexMustNot: [] }, pillars: [], visual: { colors: {}, imageStyle: "", negativePrompt: "" } };
const chan = (platform: "instagram" | "linkedin", handle: string) => ({ platform, handle, language: "sl" as const, goal: { postsPerDay: 1, weekdays: [1] }, allowedTypes: ["text" as const] });

/** Writes "Besedilo: <topic>" for whatever post it is asked about; counts calls. */
function echoLlm() {
  const calls: StructuredRequest[] = [];
  const client: LlmClient = {
    async structured(req) {
      calls.push(req);
      const topic = req.user.match(/Topic: (.*)/)?.[1] ?? "?";
      return { input: { caption: `Besedilo: ${topic}`, hashtags: [], topic_summary: topic }, usage: { inputTokens: 1000, outputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0 } };
    },
  };
  return { client, calls };
}
/** Records jobs; `drain` runs them like a worker would. */
function memoryQueue() {
  const jobs: { name: string; data: PostTextJob; key: string }[] = [];
  const q: JobQueue = { async send(name, data, key) { jobs.push({ name, data: data as PostTextJob, key }); } };
  return { q, jobs };
}

let A: OrgContext, B: OrgContext, editorA: OrgContext, brandA: string, brandA2: string, brandB: string, igA: string, liA: string, igB: string;
beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, channels, brand_sources, brand_assets, brand_designs, posts, usage_ledger, plan_imports, bulk_runs, bulk_items cascade`;
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
  brandA = (await createBrand(db, A, { name: "Inženirji", slug: "inz", languages: ["sl"] })).id;
  brandA2 = (await createBrand(db, A, { name: "AI Builders", slug: "aib", languages: ["sl"] })).id;
  brandB = (await createBrand(db, B, { name: "Cherr", slug: "cherr", languages: ["sl"] })).id;
  for (const [c, id] of [[A, brandA], [A, brandA2], [B, brandB]] as const) await saveProfile(db, c, id, { ...profile, note: "t" });
  igA = (await addChannel(db, A, brandA, chan("instagram", "@inz"))).id;
  liA = (await addChannel(db, A, brandA2, chan("linkedin", "david"))).id;
  igB = (await addChannel(db, B, brandB, chan("instagram", "@cherr"))).id;
});
afterAll(async () => { await stopBoss(); await sql.end({ timeout: 5 }); });

async function planned(ctx: OrgContext, brandId: string, channelId: string, topic: string, day: string | null, extra: Partial<typeof posts.$inferInsert> = {}) {
  const { brand } = await getBrandDetail(db, ctx, brandId);
  const id = crypto.randomUUID();
  await forOrg(db, ctx).insert(posts, {
    id, brandId, channelId, profileVersionId: brand.currentProfileVersionId!, brief: topic, status: "planned", format: "image",
    plan: { topic, slides: ["Prvi", "Drugi"], cta: "Link v bio", imagePrompt: "Temna miza" }, scheduledOn: day, createdBy: ctx.userId, ...extra,
  });
  return id;
}
const deps = (llm: LlmClient) => ({ llm, storage });
const drain = async (jobs: { data: PostTextJob }[], llm: LlmClient) => { for (const j of jobs) await runBulkItem(db, deps(llm), j.data); };
const caption = async (id: string) => (await sql`select status, content->>'caption' c from posts where id = ${id}`)[0];

describe("bulkCandidates and startBulk", () => {
  it("a day across brands: planned and failed posts without text, with a channel, live brands, this org — in slot order", async () => {
    const day = "2026-10-06";
    const p1 = await planned(A, brandA, igA, "Jutro", day, { scheduledTime: "08:00" });
    const p2 = await planned(A, brandA2, liA, "Brez ure", day);
    const p3 = await planned(A, brandA, igA, "Zgodaj", day, { scheduledTime: "06:30" });
    const failed = await planned(A, brandA, igA, "Ni uspelo", day, { status: "failed", error: "PROVIDER" });
    await planned(A, brandA, igA, "Ima besedilo", day, { status: "ready", content: { caption: "x", hashtags: [] } });
    await planned(A, brandA, igA, "Jutri", "2026-10-07");
    await planned(A, brandA, igA, "Brez kanala", day, { channelId: null });
    await planned(B, brandB, igB, "Tuja", day);
    expect(await bulkCandidates(db, A, { kind: "day", date: day })).toEqual([p3, p1, p2, failed]); // no time: in the order they were planned
    expect(await bulkCandidates(db, A, { kind: "day", date: day, brandId: brandA2 })).toEqual([p2]);
    expect(await bulkCandidates(db, A, { kind: "day", date: day, brandId: brandB })).toEqual([]);
    await setBrandArchived(db, A, brandA2, true);
    expect(await bulkCandidates(db, A, { kind: "day", date: day })).toEqual([p3, p1, failed]);
  });

  it("a brand over a range (open end); nothing to do; too many; bad scope", async () => {
    const a = await planned(A, brandA, igA, "Prvi", "2026-10-06");
    const b = await planned(A, brandA, igA, "Drugi", "2026-10-20");
    await planned(A, brandA, igA, "Prej", "2026-10-01");
    await planned(A, brandA, igA, "Brez termina", null);
    expect(await bulkCandidates(db, A, { kind: "brand", brandId: brandA, from: "2026-10-06", to: "2026-10-13" })).toEqual([a]);
    expect(await bulkCandidates(db, A, { kind: "brand", brandId: brandA, from: "2026-10-06", to: null })).toEqual([a, b]);
    const { q } = memoryQueue();
    await expect(startBulk(db, q, A, { kind: "day", date: "2027-01-01" })).rejects.toMatchObject({ code: "NOTHING_TO_DO" });
    await expect(startBulk(db, q, A, { kind: "day", date: "2026-02-30" })).rejects.toThrow();
    await sql`insert into posts (id, org_id, brand_id, channel_id, profile_version_id, brief, status, format, scheduled_on, created_by)
      select gen_random_uuid()::text, org_id, brand_id, channel_id, profile_version_id, 'x', 'planned', 'text', '2026-11-01', created_by from posts, generate_series(1, ${BULK_MAX + 1}) where id = ${a}`;
    await expect(startBulk(db, q, A, { kind: "day", date: "2026-11-01" })).rejects.toMatchObject({ code: "TOO_MANY" });
  });
});

describe("running a run", () => {
  it("writes every post once from its plan; run done with counts; one job per post, keyed per post", async () => {
    const day = "2026-10-06";
    const ids = [await planned(A, brandA, igA, "Jutro", day), await planned(A, brandA2, liA, "Večer", day)];
    const { q, jobs } = memoryQueue();
    const runId = await startBulk(db, q, editorA, { kind: "day", date: day });
    expect(jobs.map((j) => [j.name, j.key])).toEqual(ids.map((id) => [POST_TEXT_QUEUE, `post:${id}:text`]));
    expect((await listBulkRuns(db, A))[0]).toMatchObject({ id: runId, status: "queued", total: 2, counts: { queued: 2 } });
    const llm = echoLlm();
    await drain(jobs, llm.client);
    expect(await caption(ids[0])).toEqual({ status: "ready", c: "Besedilo: Jutro" });
    expect(await caption(ids[1])).toEqual({ status: "ready", c: "Besedilo: Večer" });
    expect((await listBulkRuns(db, A))[0]).toMatchObject({ status: "done", counts: { done: 2, queued: 0 } });
    // The plan went into the request: slides, CTA, image as context.
    expect(llm.calls[0].user).toContain("Slide texts:\n1. Prvi\n2. Drugi");
    expect(llm.calls[0].user).toContain("Call to action from the plan: Link v bio");
    // A job delivered twice, or a second run over the same day, never writes again.
    await drain(jobs, llm.client);
    await expect(startBulk(db, q, A, { kind: "day", date: day })).rejects.toMatchObject({ code: "NOTHING_TO_DO" });
    expect(llm.calls).toHaveLength(2);
  });

  it("two runs racing over the same posts write each post once", async () => {
    const day = "2026-10-06";
    for (let i = 0; i < 4; i++) await planned(A, brandA, igA, `Objava ${i}`, day);
    const one = memoryQueue(), two = memoryQueue();
    await startBulk(db, one.q, A, { kind: "day", date: day });
    await startBulk(db, two.q, A, { kind: "day", date: day });
    const llm = echoLlm();
    await Promise.all([drain(one.jobs, llm.client), drain(two.jobs, llm.client)]);
    expect(llm.calls).toHaveLength(4);
    const runs = await listBulkRuns(db, A);
    expect(runs.map((r) => r.counts.done + r.counts.skipped).sort()).toEqual([4, 4]);
    expect(runs.reduce((n, r) => n + r.counts.done, 0)).toBe(4);
  });

  it("spend cap reached: items fail with SPEND_CAP, the provider is never called, the run ends", async () => {
    await planned(A, brandA, igA, "Drago", "2026-10-06");
    await db.update(orgSettings).set({ spendCapMicroUsd: 10n }).where(eq(orgSettings.orgId, A.orgId));
    const { q, jobs } = memoryQueue();
    await startBulk(db, q, A, { kind: "day", date: "2026-10-06" });
    const llm = echoLlm();
    await drain(jobs, llm.client);
    expect(llm.calls).toHaveLength(0);
    expect((await listBulkRuns(db, A))[0]).toMatchObject({ status: "done", counts: { failed: 1 } });
    expect((await sql`select error from bulk_items`)[0].error).toBe("SPEND_CAP");
  });

  it("cancel: queued items are skipped and never written; another org cannot cancel; runs are listed per org", async () => {
    const id = await planned(A, brandA, igA, "Preklic", "2026-10-06");
    const { q, jobs } = memoryQueue();
    const runId = await startBulk(db, q, A, { kind: "day", date: "2026-10-06" });
    await expect(cancelBulk(db, B, runId)).rejects.toMatchObject({ code: "BAD_STATE" });
    expect(await listBulkRuns(db, B)).toEqual([]);
    await cancelBulk(db, A, runId);
    const llm = echoLlm();
    await drain(jobs, llm.client);
    expect(llm.calls).toHaveLength(0);
    expect(await caption(id)).toEqual({ status: "planned", c: null });
    expect((await listBulkRuns(db, A))[0]).toMatchObject({ status: "cancelled", counts: { skipped: 1 } });
  });

  it("the creator lost access before the job ran → NO_ACCESS, nothing written", async () => {
    const id = await planned(A, brandA, igA, "Odstranjen", "2026-10-06");
    const { q, jobs } = memoryQueue();
    await startBulk(db, q, editorA, { kind: "day", date: "2026-10-06" });
    await sql`delete from member where user_id = ${editorA.userId}`;
    const llm = echoLlm();
    await drain(jobs, llm.client);
    expect(llm.calls).toHaveLength(0);
    expect((await sql`select status, error from bulk_items`)[0]).toEqual({ status: "failed", error: "NO_ACCESS" });
    expect(await caption(id)).toEqual({ status: "planned", c: null });
  });
});

describe("planBrief", () => {
  it("uses only the plan's words and caps the length", () => {
    const b = planBrief({ brief: "x", format: "carousel", scheduledOn: null, plan: { topic: "WordPress vs Next.js", slideCount: 5, audience: "Direktorji", firstComment: "Link: inzenirji.si", notes: "brez cen" } });
    expect(b).toBe("Topic: WordPress vs Next.js\nFormat: carousel (5 slides). Write the post text (caption) only.\nAudience: Direktorji\nFirst comment (posted separately, do not repeat): Link: inzenirji.si\nNotes: brez cen");
    expect(planBrief({ brief: "x", format: "text", scheduledOn: null, plan: { topic: "t", imagePrompt: "p".repeat(5000) } }).length).toBeLessThanOrEqual(2000);
  });
});

describe("pg-boss end to end", () => {
  it("jobs sent through pg-boss are picked up by a worker and the run finishes", async () => {
    const day = "2026-10-08";
    const ids = [await planned(A, brandA, igA, "Jesenski tečaj elektrotehnike", day), await planned(A, brandA, igA, "Varnost na gradbišču", day)]; // different topics: no-repeat (TASK-029) leaves both ready
    const boss = await getBoss(url);
    const llm = echoLlm();
    await boss.work<PostTextJob>(POST_TEXT_QUEUE, { localConcurrency: 2, pollingIntervalSeconds: 0.5 }, async ([job]) => { await runBulkItem(db, deps(llm.client), job.data); });
    const runId = await startBulk(db, bossQueue(boss), A, { kind: "day", date: day });
    await expect.poll(async () => (await listBulkRuns(db, A)).find((r) => r.id === runId)?.status, { timeout: 20_000, interval: 250 }).toBe("done");
    for (const id of ids) expect((await caption(id)).status).toBe("ready");
    expect(llm.calls).toHaveLength(2);
  }, 30_000);
});

describe("cost before a run (owner, 2026-10-07)", () => {
  async function giveDesign(ctx: OrgContext, brandId: string) {
    const id = crypto.randomUUID();
    await db.insert(brandDesigns).values({ id, orgId: ctx.orgId, brandId, version: 1, status: "ready", spec: designSpecSchema.parse(cardDesign), createdBy: ctx.userId });
    await db.update(brandsTable).set({ currentDesignId: id }).where(eq(brandsTable.id, brandId));
  }
  const price = async (kind: "text" | "image" | "image_style") => (await db.select().from(modelRegistry).where(eq(modelRegistry.kind, kind)).then((r) => r.find((m) => m.isDefault)))!;

  it("counts texts and images per brand, prices them with the brand's models, an upper bound above the expected cost", async () => {
    await giveDesign(A, brandA);
    for (const d of ["2026-11-02", "2026-11-03"]) await planned(A, brandA, igA, `Tema ${d}`, d); // carousels with 2 slides
    await planned(A, brandA2, liA, "Brez podobe", "2026-11-02", { plan: { topic: "x" }, format: "text" }); // brand without design
    const scope = { kind: "brand" as const, brandId: brandA, from: "2026-11-01", to: null };
    const textOnly = await estimateBulk(db, A, scope, ["text"]);
    expect(textOnly.text).toMatchObject({ posts: 2 });
    expect(textOnly.text.model).toBe((await price("text")).label);
    expect(textOnly.image).toMatchObject({ posts: 0, expected: 0n });
    expect(textOnly.text.expected).toBeGreaterThan(0n);
    expect(textOnly.text.max).toBeGreaterThan(textOnly.text.expected);

    const both = await estimateBulk(db, A, scope, ["text", "image"]);
    const share = cardDesign.templates.filter((t) => needsIllustration(designSpecSchema.parse(cardDesign).templates.find((x) => x.id === t.id)!)).length / cardDesign.templates.length;
    expect(both.image).toMatchObject({ posts: 2, images: 4, illustrations: Math.round(2 * share) * 2, illustrationsMax: 6, noDesign: 0 });
    const flux = await price("image"); // no past-post images → the plain image model
    expect(both.image.model).toBe(flux.label);
    expect(both.image.max).toBeGreaterThanOrEqual(6n * (flux.perImage + flux.perMegapixel));
    expect(both.expected).toBe(both.text.expected + both.image.expected);
    expect(both.max).toBe(both.text.max + both.image.max);

    // Materials make the text prompt longer: the text estimate grows with them.
    await db.insert(brandSources).values({ id: crypto.randomUUID(), orgId: A.orgId, brandId: brandA, kind: "text", filename: "cenik.md", storageKey: "m", sizeBytes: 1, sha256: "b".repeat(64), contentType: "text/markdown", createdBy: A.userId, extract: { chars: 30_000 } });
    expect((await estimateBulk(db, A, scope, ["text"])).text.expected).toBeGreaterThan(textOnly.text.expected);
    // Past posts uploaded → illustrations use the style-reference model (dearer per image).
    await db.insert(brandSources).values({ id: crypto.randomUUID(), orgId: A.orgId, brandId: brandA, kind: "image", filename: "p.png", storageKey: "k", sizeBytes: 1, sha256: "a".repeat(64), contentType: "image/png", createdBy: A.userId });
    expect((await estimateBulk(db, A, scope, ["text", "image"])).image.model).toBe((await price("image_style")).label);

    // A day across brands: the brand without a design is counted apart, not priced for images.
    const day = await estimateBulk(db, A, { kind: "day", date: "2026-11-02" }, ["text", "image"]);
    expect(day.text.posts).toBe(2);
    expect(day.image).toMatchObject({ posts: 1, noDesign: 1 });
  });

  it("compares the upper bound with what is left of this month's cap; other orgs' posts never count", async () => {
    await planned(A, brandA, igA, "Ena", "2026-11-02");
    await planned(B, brandB, igB, "Tuja", "2026-11-02");
    await db.update(orgSettings).set({ spendCapMicroUsd: 1_000_000n }).where(eq(orgSettings.orgId, A.orgId));
    await db.insert(usageLedger).values({ id: crypto.randomUUID(), orgId: A.orgId, provider: "anthropic", model: "m", state: "settled", costMicroUsd: 999_990n });
    const e = await estimateBulk(db, A, { kind: "day", date: "2026-11-02" }, ["text"]);
    expect(e.text.posts).toBe(1);
    expect(e.budget).toEqual({ cap: 1_000_000n, spent: 999_990n, left: 10n });
    expect(e.overBudget).toBe(true);
    await db.update(orgSettings).set({ spendCapMicroUsd: 500_000_000n }).where(eq(orgSettings.orgId, A.orgId));
    expect((await estimateBulk(db, A, { kind: "day", date: "2026-11-02" }, ["text"])).overBudget).toBe(false);
  });

  it("a whole imported plan is one scope: its posts on any day, this org only", async () => {
    const importId = crypto.randomUUID();
    await sql`insert into plan_imports (id, org_id, filename, storage_key, sha256, kind, status, reader, created_by) values (${importId}, ${A.orgId}, 'plan.xlsx', 'k', 'x', 'table', 'imported', '{"by":"headers"}', ${A.userId})`;
    const p1 = await planned(A, brandA, igA, "Prvi", "2026-11-02", { importId });
    const p2 = await planned(A, brandA2, liA, "Brez dneva", null, { importId });
    await planned(A, brandA, igA, "Ni iz plana", "2026-11-02");
    expect(new Set(await bulkCandidates(db, A, { kind: "import", importId }))).toEqual(new Set([p1, p2]));
    expect(await bulkCandidates(db, A, { kind: "import", importId, brandId: brandA })).toEqual([p1]);
    expect(await bulkCandidates(db, B, { kind: "import", importId })).toEqual([]);
    const { q, jobs } = memoryQueue();
    await startBulk(db, q, A, { kind: "import", importId }, ["text"]);
    expect(jobs).toHaveLength(2);
  });
});

describe("imagesFor", () => {
  it("one image, or one per slide of a carousel with room for a cover", () => {
    expect(imagesFor(null, "text")).toEqual({ expected: 1, max: 1 });
    expect(imagesFor({ slides: ["a", "b", "c"] }, "carousel")).toEqual({ expected: 3, max: 4 });
    expect(imagesFor({ slideCount: 5 }, "image")).toEqual({ expected: 5, max: 6 });
    expect(imagesFor({}, "carousel")).toEqual({ expected: 2, max: 3 });
    expect(imagesFor({ slideCount: 40 }, "carousel")).toEqual({ expected: 20, max: 20 });
  });
});
