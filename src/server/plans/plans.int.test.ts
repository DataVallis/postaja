// Plan import end to end against Postgres + S3 stand-in (TASK-012): AI and header readers, review choices, posts
// created verbatim and rule-checked, history, duplicates, double confirm, tenancy.
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { image, makeDocx, makeXlsx } from "../../../tests/fixtures/files";
import { addChannel, createBrand, saveProfile } from "../brands/service";
import { createS3Storage, s3ConfigFromEnv } from "../files/storage";
import { createFakeLlm, type FakeAnswer } from "../llm/fake";
import { LlmError } from "../llm/types";
import { createOrganization } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { editPost } from "../posts/generate";
import { confirmImport, discardImport, importView, listImports, reopenImport, startImport, updateImport } from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const storage = createS3Storage(s3ConfigFromEnv());
const profile = (banned: string[] = []) => ({ cgp: "CGP", rules: { bannedWords: banned, ctaPhrases: [], regexMust: [], regexMustNot: [] }, pillars: [], visual: { colors: {}, imageStyle: "", negativePrompt: "" } });
const chan = (platform: "instagram" | "linkedin" | "x", handle: string) => ({ platform, handle, language: "sl" as const, goal: { postsPerDay: 1, weekdays: [1] }, allowedTypes: ["text" as const] });

const plan = () => makeXlsx([{ name: "Plan objav", rows: [
  ["Datum", "Dan", "Ura", "Platforma", "Račun", "Format", "Tema", "Besedilo objave", "Prompt za sliko (AI)", "Carousel slide-i", "Hashtagi", "Status"],
  [46294, "tor", "08:30", "LinkedIn", "David (osebni profil)", "Text + image", "Problem", "AI can write an app in an afternoon.", "A figure at a wall", "—", "#AIEngineering", "Za objavo"],
  [46294, "tor", "18:00", "Instagram", "@aibuilders", "Carousel (3)", "Problem", "Vibe coding is easy. Until it isn't.", "Isometric laptop", "1: Easy.\n2: Deploy fails.\n3: Learn the method.", "#vibecoding #nocode", "Objavljeno"],
  [46296, "čet", "13:00", "X", "@davitacer", "Thread (2)", "Tip", "2 signs 🧵\n\n1/ Phone.\n\n2/ Keys.", "—", "—", "", "Za objavo"],
  [46297, "pet", "09:00", "Instagram", "@aibuilders", "Single image", "Poceni", "Poceni tečaj danes.", "x", "—", "", "pending"],
  [46298, "sob", "10:00", "Instagram", "@aibuilders", "Video", "Reel", "", "", "", "", "pending"],
  [46299, "ned", "10:00", "Instagram", "@aibuilders", "Single image", "Off", "Preskočeno besedilo.", "", "", "", "preskočeno"],
] }]);
const aiMapping = { columns: ["date", "ignore", "time", "platform", "account", "format", "topic", "text", "image_prompt", "slides", "hashtags", "status"], defaultPlatform: null };

let A: OrgContext, B: OrgContext, editorA: OrgContext, liA: string, xA: string, igA: string, igB: string;
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
  editorA = { ...A, role: "editor" };
  const david = (await createBrand(db, A, { name: "David Tacer", slug: "davidtacer", languages: ["en"] })).id;
  const aib = (await createBrand(db, A, { name: "AI Builders", slug: "aibuilders", languages: ["en"] })).id;
  await saveProfile(db, A, david, { ...profile(), note: "t" });
  await saveProfile(db, A, aib, { ...profile(["poceni"]), note: "t" });
  liA = (await addChannel(db, A, david, { ...chan("linkedin", "davidtacer"), language: "en" })).id;
  xA = (await addChannel(db, A, david, { ...chan("x", "@davitacer"), language: "en" })).id;
  igA = (await addChannel(db, A, aib, { ...chan("instagram", "@aibuilders"), language: "en" })).id;
  const cherr = (await createBrand(db, B, { name: "Cherr", slug: "cherr", languages: ["en"] })).id;
  await saveProfile(db, B, cherr, { ...profile(), note: "t" });
  igB = (await addChannel(db, B, cherr, { ...chan("instagram", "@aibuilders"), language: "en" })).id;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

const start = (ctx: OrgContext, bytes: Uint8Array, filename = "AI-Builders-30-dni.xlsx", answers: FakeAnswer[] = [{ input: aiMapping }]) => {
  const llm = createFakeLlm(answers);
  return { llm, id: startImport(db, { llm: llm.client, storage }, ctx, { filename, bytes }) };
};

describe("reading a spreadsheet plan", () => {
  it("AI names the columns from header + samples; the call is cost-capped and logged; the file is kept in S3", async () => {
    const { llm, id } = start(A, plan());
    const importId = await id;
    expect(llm.requests[0].tool.name).toBe("map_plan_columns");
    expect(JSON.parse(llm.requests[0].user)).toMatchObject({ sheet: "Plan objav", header: expect.arrayContaining(["Besedilo objave"]) });
    const v = await importView(db, A, importId);
    expect(v.import).toMatchObject({ kind: "table", status: "draft", reader: { by: "ai" } });
    expect(v.items).toHaveLength(6);
    expect(await sql`select state, brand_id, post_id from usage_ledger`).toEqual([{ state: "settled", brand_id: null, post_id: null }]);
    expect((await storage.get(v.import.storageKey)).byteLength).toBeGreaterThan(100);
    expect(v.import.storageKey).toMatch(new RegExp(`^org/${A.orgId}/imports/`));
  });

  it("AI failure or nonsense → header reading; channels suggested by platform + handle", async () => {
    for (const answers of [[{ error: new LlmError("PROVIDER") }], [{ input: { columns: "nope" } }]]) {
      const importId = await start(A, plan(), "p.xlsx", answers as never).id;
      const v = await importView(db, A, importId);
      expect(v.import.reader.by).toBe("headers");
      expect(v.items[0]).toMatchObject({ date: "2026-09-29", time: "08:30", platform: "linkedin", format: "image" });
      const g = Object.fromEntries(v.groups.map((x) => [x.key, x.channelId]));
      expect(g).toEqual({ "linkedin|David (osebni profil)": liA, "instagram|@aibuilders": igA, "x|@davitacer": xA });
    }
  });

  it("spend cap reached → the import is refused before any call", async () => {
    await sql`update org_settings set spend_cap_micro_usd = 0`;
    const { llm, id } = start(A, plan());
    await expect(id).rejects.toMatchObject({ code: "SPEND_CAP" });
    expect(llm.requests).toHaveLength(0);
  });

  it("refusals: empty, image, a sheet without rows", async () => {
    await expect(start(A, new Uint8Array()).id).rejects.toMatchObject({ code: "EMPTY" });
    await expect(start(A, await image("png"), "x.png").id).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
    await expect(start(A, makeXlsx([{ name: "S", rows: [["Datum", "Besedilo"]] }])).id).rejects.toMatchObject({ code: "NO_POSTS" });
  });
});

describe("reading a document plan", () => {
  it("AI lists posts; shared image style prepended; reworded text flagged", async () => {
    const doc = makeDocx([
      { text: "LinkedIn series", style: "Heading1" }, { text: "Base style: navy, amber." },
      { text: "Post 1: 25 bugs", style: "Heading2" }, { text: "The code compiled. The tests were green." }, { text: "#AIEngineering" },
      { text: "Post 2: reviewer", style: "Heading2" }, { text: "The AI that writes your code is the worst judge of it." },
    ]);
    const answer = { sharedImageStyle: "Base style: navy, amber.", defaultPlatform: "LinkedIn", items: [
      { title: "25 bugs", text: "The code compiled. The tests were green.", hashtags: ["AIEngineering"], imagePrompt: "Scene: a stack of code blocks" },
      { title: "reviewer", text: "The AI that writes code is a bad judge.", firstComment: "Link in comments" },
    ] };
    const importId = await start(A, doc, "davidtacer-LinkedIn.docx", [{ input: answer }]).id;
    const v = await importView(db, A, importId);
    expect(v.import.kind).toBe("document");
    expect(v.items[0]).toMatchObject({ platform: "linkedin", topic: "25 bugs", hashtags: ["#AIEngineering"], imagePrompt: "Base style: navy, amber.\n\nScene: a stack of code blocks", format: "image", warnings: [] });
    expect(v.items[1]).toMatchObject({ firstComment: "Link in comments", warnings: ["TEXT_CHANGED"] });
    // undated: spread from the start date every 3 days once the owner sets them
    await updateImport(db, A, importId, { startDate: "2026-10-12", intervalDays: 3 });
    expect((await importView(db, A, importId)).schedule).toEqual(["2026-10-12", "2026-10-15"]);
  });

  it("documents need the AI: a provider error is reported, nothing stored", async () => {
    await expect(start(A, makeDocx([{ text: "Post 1" }]), "x.docx", [{ error: new LlmError("NOT_CONFIGURED") }]).id).rejects.toMatchObject({ code: "AI_FAILED", detail: "NOT_CONFIGURED" });
    expect((await sql`select count(*)::int n from plan_imports`)[0].n).toBe(0);
  });
});

describe("confirming", () => {
  it("creates posts verbatim per channel: history, ready, needs review, planned; skipped rows left out; text + missing hashtags", async () => {
    const importId = await start(A, plan()).id;
    const counts = await confirmImport(db, A, importId);
    expect(counts).toEqual({ created: 5, duplicates: 0, skipped: 1, noChannel: 0, published: 1, planned: 1, needsReview: 1, moved: 0 });
    const rows = await sql`select channel_id, status, format, content, plan, scheduled_on::text as day, scheduled_time, published_at is not null as pub, rule_failures from posts order by scheduled_on, scheduled_time`;
    expect(rows.map((r) => [r.channel_id, r.status, r.format, r.day, r.scheduled_time])).toEqual([
      [liA, "ready", "image", "2026-09-29", "08:30"],
      [igA, "published", "carousel", "2026-09-29", "18:00"],
      [xA, "ready", "thread", "2026-10-01", "13:00"],
      [igA, "needs_review", "image", "2026-10-02", "09:00"],
      [igA, "planned", "video", "2026-10-03", "10:00"],
    ]);
    expect(rows[0].content).toEqual({ caption: "AI can write an app in an afternoon.\n\n#AIEngineering", hashtags: ["#AIEngineering"] });
    expect(rows[1]).toMatchObject({ pub: true, plan: { slides: ["Easy.", "Deploy fails.", "Learn the method."], slideCount: 3, imagePrompt: "Isometric laptop", topic: "Problem", account: "@aibuilders", sourceRef: "Plan objav!3" } });
    expect(rows[2].content.parts).toEqual(["2 signs 🧵", "1/ Phone.", "2/ Keys."]);
    expect(rows[3].rule_failures[0].code).toBe("banned_word");
    expect(rows[4].content).toBeNull();
    expect((await listImports(db, A))[0]).toMatchObject({ status: "imported", createdCount: 5 });
  });

  it("owner choices: skip a platform, never put one platform's rows on another's channel; a second import only adds what is new", async () => {
    const first = await start(A, plan()).id;
    // LinkedIn rows on the Instagram channel are refused (owner, 2026-10-06: LinkedIn posts ended up under Instagram).
    await expect(updateImport(db, A, first, { channelMap: { "linkedin|David (osebni profil)": igA } })).rejects.toMatchObject({ code: "PLATFORM_MISMATCH" });
    await updateImport(db, A, first, { channelMap: { "x|@davitacer": "skip" } });
    expect(await confirmImport(db, A, first)).toMatchObject({ created: 4, skipped: 2 });
    expect((await sql`select count(*)::int n from posts where channel_id = ${igA}`)[0].n).toBe(3);
    const again = await start(A, plan()).id;
    expect(await confirmImport(db, A, again)).toMatchObject({ created: 1, duplicates: 4 }); // X is new now
  });

  it("posts written or edited by hand since the first import are not imported again", async () => {
    const first = await start(A, plan()).id;
    expect(await confirmImport(db, A, first)).toMatchObject({ created: 5 });
    const [planned] = await sql`select id from posts where status = 'planned'`;
    await editPost(db, A, planned.id, { caption: "Napisano na roke." });
    const [li] = await sql`select id from posts where channel_id = ${liA}`;
    await editPost(db, A, li.id, { caption: "Popravljeno besedilo." });
    const again = await start(A, plan()).id;
    expect(await confirmImport(db, A, again)).toMatchObject({ created: 0, duplicates: 5 });
    expect((await sql`select count(*)::int n from posts`)[0].n).toBe(5);
  });

  it("a double confirm cannot import twice; discarded and imported imports are frozen", async () => {
    const importId = await start(A, plan()).id;
    const results = await Promise.allSettled([confirmImport(db, A, importId), confirmImport(db, A, importId)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await sql`select count(*)::int n from posts`)[0].n).toBe(5);
    await expect(updateImport(db, A, importId, { startDate: "2026-11-01" })).rejects.toMatchObject({ code: "BAD_STATE" });
    const other = await start(A, plan()).id;
    await discardImport(db, A, other);
    await expect(confirmImport(db, A, other)).rejects.toMatchObject({ code: "BAD_STATE" });
  });

  it("rows without a channel at import time can be imported later: add the channel, reopen, import — nothing doubles", async () => {
    const bImport = await start(B, plan()).id;
    expect(await confirmImport(db, B, bImport)).toMatchObject({ created: 3, noChannel: 2 }); // only Instagram existed
    const brandB = (await sql`select brand_id from channels where id = ${igB}`)[0].brand_id as string;
    const liB = (await addChannel(db, B, brandB, { ...chan("linkedin", "davidtacer"), language: "en" })).id;
    await expect(reopenImport(db, A, bImport)).rejects.toMatchObject({ code: "BAD_STATE" }); // other org
    await reopenImport(db, B, bImport);
    expect((await importView(db, B, bImport)).groups.find((g) => g.platform === "linkedin")!.channelId).toBe(liB); // suggested now
    expect(await confirmImport(db, B, bImport)).toMatchObject({ created: 1, duplicates: 3, noChannel: 1 });
    expect((await sql`select created_count, status from plan_imports where id = ${bImport}`)[0]).toEqual({ created_count: 4, status: "imported" });
    await expect(reopenImport(db, A, await start(A, plan()).id)).rejects.toMatchObject({ code: "BAD_STATE" }); // a draft is not "imported"
  });

  it("rows go only to channels of their own platform; rows misplaced before that guard are moved on re-import", async () => {
    const importId = await start(B, plan()).id;
    await expect(updateImport(db, B, importId, { channelMap: { "linkedin|davidtacer": igB } })).rejects.toMatchObject({ code: "PLATFORM_MISMATCH" });
    // An old import saved LinkedIn rows on the Instagram channel (no guard then): reproduce it directly.
    const v = await importView(db, B, importId);
    const li = v.groups.find((g) => g.platform === "linkedin")!;
    await sql`update plan_imports set settings = jsonb_set(settings, '{channelMap}', ${sql.json({ [li.key]: igB })}) where id = ${importId}`;
    expect((await importView(db, B, importId)).groups.find((g) => g.key === li.key)!.channelId).toBeNull(); // ignored now
    await sql`update plan_imports set status = 'imported' where id = ${importId}`;
    // Simulate what the old code created: the LinkedIn rows as Instagram posts of this import.
    const brandB = (await sql`select brand_id from channels where id = ${igB}`)[0].brand_id as string;
    const pv = (await sql`select current_profile_version_id v from brands where id = ${brandB}`)[0].v as string;
    const liItems = v.items.filter((i) => i.platform === "linkedin");
    for (const i of liItems) {
      await sql`insert into posts (id, org_id, brand_id, channel_id, profile_version_id, brief, status, format, plan, import_id, created_by, media_status)
        values (${crypto.randomUUID()}, ${B.orgId}, ${brandB}, ${igB}, ${pv}, 'x', 'planned', 'text', ${sql.json({ sourceRef: i.ref })}, ${importId}, ${B.userId}, 'ready')`;
    }
    const liB = (await addChannel(db, B, brandB, { ...chan("linkedin", "davidtacer"), language: "en" })).id;
    await reopenImport(db, B, importId);
    const counts = await confirmImport(db, B, importId);
    expect(counts).toMatchObject({ moved: liItems.length, created: 3 });
    const onLi = await sql`select media_status, visual from posts where channel_id = ${liB}`;
    expect(onLi).toHaveLength(liItems.length);
    expect(onLi.every((p) => p.media_status === "none" && p.visual === null)).toBe(true);
    expect((await sql`select count(*)::int n from posts where channel_id = ${igB} and import_id = ${importId}`)[0].n).toBe(3);
  });

  it("an editor can import too", async () => {
    const importId = await start(editorA, plan()).id;
    expect((await confirmImport(db, editorA, importId)).created).toBe(5);
  });
});

describe("tenancy", () => {
  it("another org cannot see, change, map to, confirm or discard the import; its channels are never suggested or accepted", async () => {
    const importId = await start(A, plan()).id;
    await expect(importView(db, B, importId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateImport(db, B, importId, { startDate: "2026-11-01" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(confirmImport(db, B, importId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(discardImport(db, B, importId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listImports(db, B)).toEqual([]);
    // org B's channel has the same handle but is never suggested or accepted for org A
    const v = await importView(db, A, importId);
    expect(v.channels.map((c) => c.id)).not.toContain(igB);
    await expect(updateImport(db, A, importId, { channelMap: { "instagram|@aibuilders": igB } })).rejects.toMatchObject({ code: "INVALID" });
    const bImport = await start(B, plan()).id;
    const vb = await importView(db, B, bImport);
    expect(vb.groups.find((g) => g.platform === "instagram")!.channelId).toBe(igB);
    expect(vb.groups.find((g) => g.platform === "linkedin")!.channelId).toBeNull();
    expect((await confirmImport(db, B, bImport))).toMatchObject({ created: 3, noChannel: 2 });
    expect((await sql`select count(*)::int n from posts where org_id = ${A.orgId}`)[0].n).toBe(0);
  });
});
