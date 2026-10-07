// AI post ideas (TASK-019, ADR-048): prompt inputs, no-repeat replacement, free slots, accepting into the plan, refusals.
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { addChannel, createBrand, getBrandDetail, saveProfile } from "../brands/service";
import { orgSettings, posts } from "../db/schema";
import { createFakeLlm } from "../llm/fake";
import { LlmError } from "../llm/types";
import { createOrganization, inviteMember } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { eq } from "drizzle-orm";
import { acceptIdeas, discardIdeas, freeSlots, getIdeaRun, suggestIdeas } from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const NOW = new Date("2026-10-07T08:00:00Z"); // a Wednesday
const profile = {
  cgp: "AI Builders uči ne-programerje graditi aplikacije z AI.", rules: { bannedWords: [], ctaPhrases: [], regexMust: [], regexMustNot: [] },
  pillars: [{ name: "Metoda", description: "Kako graditi", share: 60 }, { name: "Zgodbe", description: "Primeri", share: 40 }],
  visual: { colors: {}, imageStyle: "", negativePrompt: "" },
};

let A: OrgContext, B: OrgContext, editorA: OrgContext, brandA: string, igA: string, igB: string;
beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, channels, posts, usage_ledger, idea_runs cascade`;
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
  brandA = (await createBrand(db, A, { name: "AI Builders", slug: "aib", languages: ["sl"] })).id;
  await saveProfile(db, A, brandA, { ...profile, note: "t" });
  // Instagram on Mon, Wed, Fri; one post a day; images and carousels.
  igA = (await addChannel(db, A, brandA, { platform: "instagram", handle: "@aib", language: "sl", goal: { postsPerDay: 1, weekdays: [1, 3, 5] }, allowedTypes: ["single_image", "carousel"] })).id;
  const brandB = (await createBrand(db, B, { name: "Drugi", slug: "drugi", languages: ["sl"] })).id;
  await saveProfile(db, B, brandB, { ...profile, note: "t" });
  igB = (await addChannel(db, B, brandB, { platform: "instagram", handle: "@d", language: "sl", goal: { postsPerDay: 1, weekdays: [1] }, allowedTypes: ["single_image"] })).id;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

async function existing(topic: string, day: string | null, x: Partial<typeof posts.$inferInsert> = {}) {
  const { brand } = await getBrandDetail(db, A, brandA);
  const id = crypto.randomUUID();
  await forOrg(db, A).insert(posts, { id, brandId: brandA, channelId: igA, profileVersionId: brand.currentProfileVersionId!, brief: topic, status: "ready", format: "image", scheduledOn: day, plan: { topic }, createdBy: A.userId, ...x });
  return id;
}
const idea = (title: string, angle: string, pillar: string | null = "Metoda", format = "image") => ({ title, angle, pillar, format });

describe("suggesting ideas", () => {
  it("Claude gets the CGP, pillars with recent counts and recent topics; repeats are replaced; ideas get the channel's free slots", async () => {
    const agents = await existing("AGENTS.md datoteka: najcenejši način, da AI agent pozna projekt", "2026-10-02", { plan: { topic: "AGENTS.md datoteka: najcenejši način, da AI agent pozna projekt", category: "Metoda" } });
    await existing("Zakaj vibe-coded aplikacije padejo v produkciji brez testov", "2026-10-09"); // takes Friday 9. 10.
    await existing("Preskočena tema o cenah tečaja", "2026-09-20", { status: "skipped" });
    const llm = createFakeLlm([
      { input: { ideas: [
        idea("Pet korakov do prve aplikacije", "Od ideje do delujoče aplikacije v petih korakih."),
        idea("AGENTS.md: najcenejši način, da AI agent pozna projekt", "Datoteka AGENTS.md da agentu kontekst projekta."), // repeat
        idea("Zgodba: Maja je zgradila CRM v enem vikendu", "Primer tečajnice in kaj se je naučila.", "Zgodbe", "carousel"),
      ] } },
      { input: { ideas: [idea("Kako napisati dober prompt za popravek napake", "Opiši napako, pričakovanje in korake.")] } },
    ]);
    const id = await suggestIdeas(db, { llm: llm.client, now: NOW }, editorA, { brandId: brandA, channelId: igA, count: 3, hint: "Ta teden o začetkih." });
    // First call: the inputs.
    const first = llm.requests[0];
    expect(first.tool.name).toBe("suggest_post_ideas");
    expect(first.user).toContain("AI Builders uči ne-programerje");
    expect(first.user).toContain("- Metoda (target 60%, recent posts 1): Kako graditi");
    expect(first.user).toContain("2026-10-02: AGENTS.md datoteka");
    expect(first.user).not.toContain("Preskočena tema"); // skipped posts are not memory
    expect(first.user).toContain('language="Slovenian"');
    expect(first.user).toContain('formats="image,carousel"');
    expect(first.user).toContain("<owner_wish>\nTa teden o začetkih.\n</owner_wish>");
    expect(first.user).toContain("Propose exactly 3 ideas");
    // Second call: one replacement, told what was rejected and what is already kept.
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[1].user).toContain("Propose exactly 1 idea.");
    expect(llm.requests[1].user).toContain("- AGENTS.md: najcenejši način, da AI agent pozna projekt");
    const run = await getIdeaRun(db, A, id);
    expect(run).toMatchObject({ status: "draft", replaced: 1, hint: "Ta teden o začetkih." });
    expect(run.ideas.map((i) => i.title)).toEqual(["Pet korakov do prve aplikacije", "Zgodba: Maja je zgradila CRM v enem vikendu", "Kako napisati dober prompt za popravek napake"]);
    // Free slots from Wed 7. 10. on Mon/Wed/Fri, Fri 9. 10. already taken.
    expect(run.ideas.map((i) => i.date)).toEqual(["2026-10-07", "2026-10-12", "2026-10-14"]);
    expect(run.ideas[1]).toMatchObject({ pillar: "Zgodbe", format: "carousel" });
    expect(agents).toBeTruthy();
    // The calls were paid through the cap.
    expect((await sql`select count(*)::int n from usage_ledger where org_id = ${A.orgId} and state = 'settled'`)[0].n).toBe(2);
  });

  it("a close but not repeating idea is kept with a 'similar' note; two ideas on one topic keep only one", async () => {
    const near = await existing("Pet korakov do prve aplikacije brez programiranja", "2026-09-28");
    const llm = createFakeLlm([
      { input: { ideas: [idea("Prva aplikacija brez programiranja v petih korakih", "Kratek vodič."), idea("Cenik tečaja in popust", "Kaj dobiš."), idea("Cenik tečaja: popust", "Kaj dobiš za ceno.")] } },
      { input: { ideas: [idea("Kako izbrati prvo idejo za aplikacijo", "Majhen problem, ki ga poznaš.")] } },
    ]);
    const run = await getIdeaRun(db, A, await suggestIdeas(db, { llm: llm.client, now: NOW }, A, { brandId: brandA, channelId: igA, count: 3 }));
    expect(run.ideas[0].similar).toMatchObject({ postId: near, date: "2026-09-28" });
    expect(run.ideas[0].similar!.score).toBeGreaterThanOrEqual(0.4);
    expect(run.ideas.map((i) => i.title)).toEqual(["Prva aplikacija brez programiranja v petih korakih", "Cenik tečaja in popust", "Kako izbrati prvo idejo za aplikacijo"]);
    expect(run.replaced).toBe(1);
  });

  it("refusals: another org's brand or channel, the spend cap, a provider error, only repeats", async () => {
    await expect(suggestIdeas(db, { llm: createFakeLlm().client, now: NOW }, B, { brandId: brandA, channelId: igA, count: 3 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(suggestIdeas(db, { llm: createFakeLlm().client, now: NOW }, A, { brandId: brandA, channelId: igB, count: 3 })).rejects.toMatchObject({ code: "NO_CHANNEL" });
    await expect(suggestIdeas(db, { llm: createFakeLlm().client, now: NOW }, A, { brandId: brandA, channelId: igA, count: 31 })).rejects.toThrow();
    await expect(suggestIdeas(db, { llm: createFakeLlm([{ error: new LlmError("PROVIDER", "boom") }]).client, now: NOW }, A, { brandId: brandA, channelId: igA, count: 2 })).rejects.toMatchObject({ code: "AI_FAILED" });
    await existing("Cenik tečaja in popust za zgodnje prijave", "2026-10-01");
    const repeat = { input: { ideas: [idea("Cenik tečaja in popust za zgodnje prijave", "Isto kot prej.")] } };
    await expect(suggestIdeas(db, { llm: createFakeLlm([repeat, repeat, repeat]).client, now: NOW }, A, { brandId: brandA, channelId: igA, count: 1 })).rejects.toMatchObject({ code: "AI_FAILED", detail: "ALL_REPEATS" });
    await db.update(orgSettings).set({ spendCapMicroUsd: 0n }).where(eq(orgSettings.orgId, A.orgId));
    await expect(suggestIdeas(db, { llm: createFakeLlm().client, now: NOW }, A, { brandId: brandA, channelId: igA, count: 2 })).rejects.toMatchObject({ code: "SPEND_CAP" });
  });
});

describe("accepting ideas", () => {
  async function run(other = false) {
    const llm = createFakeLlm([{ input: { ideas: other
      ? [idea("Četrta tema o oblikovanju", "Barve."), idea("Peta tema o domenah", "Imena."), idea("Šesta tema o gostovanju", "Strežniki.")]
      : [idea("Prva", "Kot prva."), idea("Druga", "Kot druga.", "Zgodbe", "carousel"), idea("Tretja", "Kot tretja.")] } }]);
    return suggestIdeas(db, { llm: llm.client, now: NOW }, A, { brandId: brandA, channelId: igA, count: 3 });
  }

  it("ticked ideas become planned posts on the channel with their (changed) days; once only", async () => {
    const id = await run();
    expect(await acceptIdeas(db, editorA, id, [{ index: 1, date: "2026-10-20" }, { index: 2, date: null }])).toEqual({ created: 2 });
    const created = await sql`select brief, status, format, scheduled_on::text, plan, channel_id from posts where brand_id = ${brandA} order by brief`;
    expect(created).toEqual([
      { brief: "Druga\n\nKot druga.", status: "planned", format: "carousel", scheduled_on: "2026-10-20", plan: { topic: "Druga", notes: "Kot druga.", category: "Zgodbe" }, channel_id: igA },
      { brief: "Tretja\n\nKot tretja.", status: "planned", format: "image", scheduled_on: null, plan: { topic: "Tretja", notes: "Kot tretja.", category: "Metoda" }, channel_id: igA },
    ]);
    expect(await getIdeaRun(db, A, id)).toMatchObject({ status: "accepted", createdCount: 2 });
    await expect(acceptIdeas(db, A, id, [{ index: 0, date: null }])).rejects.toMatchObject({ code: "BAD_STATE" });
    // Two clicks at once still create the posts once.
    const id2 = await run(true);
    const both = await Promise.allSettled([acceptIdeas(db, A, id2, [{ index: 0, date: null }]), acceptIdeas(db, A, id2, [{ index: 0, date: null }])]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("refusals: another org, an index that does not exist, discarded runs", async () => {
    const id = await run();
    await expect(acceptIdeas(db, B, id, [{ index: 0, date: null }])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getIdeaRun(db, B, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(acceptIdeas(db, A, id, [{ index: 7, date: null }])).rejects.toMatchObject({ code: "INVALID" });
    expect((await sql`select count(*)::int n from posts where brand_id = ${brandA}`)[0].n).toBe(0); // nothing half-created
    await discardIdeas(db, A, id);
    await expect(acceptIdeas(db, A, id, [{ index: 0, date: null }])).rejects.toMatchObject({ code: "BAD_STATE" });
    await expect(discardIdeas(db, A, id)).rejects.toMatchObject({ code: "BAD_STATE" });
  });
});

describe("freeSlots", () => {
  it("the channel's weekdays and posts per day, minus taken places; no goal → every day", () => {
    expect(freeSlots({ postsPerDay: 1, weekdays: [1, 3, 5] }, "2026-10-07", 4, new Map([["2026-10-09", 1]]))).toEqual(["2026-10-07", "2026-10-12", "2026-10-14", "2026-10-16"]);
    expect(freeSlots({ postsPerDay: 2, weekdays: [3] }, "2026-10-07", 3, new Map([["2026-10-07", 1]]))).toEqual(["2026-10-07", "2026-10-14", "2026-10-14"]);
    expect(freeSlots({ postsPerDay: 0, weekdays: [] }, "2026-10-07", 2, new Map())).toEqual(["2026-10-07", "2026-10-08"]);
  });
});
