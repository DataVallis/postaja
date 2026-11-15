// TASK-061: the conversation next to the post, on a real database with a fake Claude.
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { cardDesign } from "../../../tests/fixtures/design";
import { addChannel, createBrand, saveProfile } from "../brands/service";
import { brandDesigns, brands, posts } from "../db/schema";
import { designSpecSchema } from "../design/spec";
import { createS3Storage, s3ConfigFromEnv } from "../files/storage";
import { createFakeLlm, type FakeAnswer } from "../llm/fake";
import { LlmError } from "../llm/types";
import { createOrganization } from "../orgs/service";
import { generatePost, getPost } from "../posts/generate";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { ChatError, chatTurn, listMessages, startConversation } from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const storage = createS3Storage(s3ConfigFromEnv());

let A: OrgContext, B: OrgContext, brandA: string, igA: string;
const first = { caption: "Nov tečaj je tu. Prijave so odprte do petka. Link v bio", hashtags: ["tecaj"], topic_summary: "Course launch." };
const shorter = { caption: "Nov tečaj. Prijave do petka. Link v bio", hashtags: ["tecaj"], topic_summary: "Course launch, short." };

function queue() {
  const jobs: { name: string; data: Record<string, unknown>; key: string }[] = [];
  return { jobs, q: { async send(name: string, data: object, key: string) { jobs.push({ name, data: data as Record<string, unknown>, key }); } } };
}
const ledger = () => sql`select action, state from usage_ledger order by created_at`;

async function newPost(answers: FakeAnswer[] = [{ input: first }]) {
  return generatePost(db, { llm: createFakeLlm(answers).client, storage }, A, { brandId: brandA, channelId: igA, brief: "Napovej jesenski tečaj" });
}
function turn(answers: FakeAnswer[], postId: string, message: string, ctx = A) {
  const llm = createFakeLlm(answers);
  const qu = queue();
  return { llm, qu, run: () => chatTurn(db, { llm: llm.client, storage, queue: qu.q }, ctx, postId, message) };
}
const route = (text: string, images: string, reply = "Prav, popravim.") => ({ input: { text, images, reply } });

beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, channels, brand_sources, brand_assets, posts, usage_ledger, post_messages, brand_designs cascade`;
  const s = (await session((await signIn("boss@datavallis.com"))!))!;
  const actor = { userId: s.user.id, role: "superadmin" as const };
  const deps0 = { mailer, baseURL: "http://localhost:3000" };
  const a = await createOrganization(db, deps0, actor, { name: "Org A", slug: "org-a", plan: "pro", ownerEmail: "boss@datavallis.com" });
  const b = await createOrganization(db, deps0, actor, { name: "Org B", slug: "org-b", plan: "pro", ownerEmail: "b@b.si" });
  const bUser = (await session((await signIn("b@b.si"))!))!.user;
  A = { userId: s.user.id, orgId: a.orgId, orgName: "Org A", role: "owner", plan: "pro" };
  B = { userId: bUser.id, orgId: b.orgId, orgName: "Org B", role: "owner", plan: "pro" };
  brandA = (await createBrand(db, A, { name: "Inženirji", slug: "inzenirji", languages: ["sl"] })).id;
  await saveProfile(db, A, brandA, { cgp: "Pišemo toplo in kratko.", rules: { bannedWords: [], ctaPhrases: ["link v bio"], regexMust: [], regexMustNot: [], mustEndWithCta: true }, pillars: [], visual: { colors: {}, imageStyle: "", negativePrompt: "" }, note: "t" });
  igA = (await addChannel(db, A, brandA, { platform: "instagram", handle: "@inz", language: "sl", goal: { postsPerDay: 1, weekdays: [1] }, allowedTypes: ["text", "single_image"] })).id;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

describe("conversation next to the post (TASK-061)", () => {
  it("a text correction: Claude routes it, the writer rewrites with the current text and the correction; history kept", async () => {
    const id = await newPost();
    await setStatus(id, "approved");
    const t = turn([route("Naj bo krajše.", ""), { input: shorter }], id, "Preveč je dolgo, skrajšaj.");
    expect(await t.run()).toEqual({ text: true });
    const p = await getPost(db, A, id);
    expect(p.content?.caption).toBe("Nov tečaj. Prijave do petka. Link v bio\n\n#tecaj");
    expect(p.status).toBe("ready"); // a changed post needs approving again
    expect(t.llm.requests.map((r) => r.tool.name)).toEqual(["route_message", "submit_post"]);
    expect(t.llm.requests[0].user).toContain("Nov tečaj je tu. Prijave so odprte do petka.");
    expect(t.llm.requests[1].user).toContain("The owner asks for this change:\nNaj bo krajše.");
    expect(t.llm.requests[1].user).toContain("<post>\nNov tečaj je tu.");
    expect(t.qu.jobs).toEqual([]);
    expect((await listMessages(db, A, id)).map((m) => [m.role, m.body, m.meta])).toEqual([
      ["user", "Preveč je dolgo, skrajšaj.", {}],
      ["assistant", "Prav, popravim.", { text: true }],
    ]);
    expect((await ledger()).map((r) => r.action)).toEqual(["text", "assist", "text"]); // new post, routing (free), rewrite
  });

  it("a question changes nothing; the answer is kept", async () => {
    const id = await newPost();
    const t = turn([route("", "", "Hashtag je en, ker tako pravi CGP.")], id, "Zakaj samo en hashtag?");
    expect(await t.run()).toEqual({});
    expect((await getPost(db, A, id)).content?.caption).toContain("Prijave so odprte do petka");
    expect((await listMessages(db, A, id)).at(-1)).toMatchObject({ role: "assistant", body: "Hashtag je en, ker tako pravi CGP.", meta: {} });
  });

  it("an image correction queues the image job with only that change; without a design the reason is answered", async () => {
    const id = await newPost();
    const noDesign = turn([route("", "Drug naslov na prvi sliki.")], id, "Na sliki naj piše drug naslov.");
    expect(await noDesign.run()).toEqual({ error: "IMAGES_NO_DESIGN" });
    expect(noDesign.qu.jobs).toEqual([]);

    await withDesign();
    await forOrg(db, A).update(posts, { visual: { designId: "d", designVersion: 1, slides: [{ templateId: "t", slots: { headline: "Star naslov" }, illustration: null }] }, mediaStatus: "ready" } as never, eq(posts.id, id));
    const t = turn([route("Konec naj bo bolj oseben.", "Drug naslov na prvi sliki."), { input: shorter }], id, "Konec bolj oseben, na sliki drug naslov.");
    expect(await t.run()).toEqual({ text: true, images: true });
    expect(t.qu.jobs).toEqual([{ name: "post-image", data: { postId: id, mode: "revise", instruction: "Drug naslov na prvi sliki." }, key: `post:${id}:image` }]);
    expect(t.llm.requests[0].user).toContain("Image 1: headline: Star naslov");
    expect((await getPost(db, A, id)).mediaStatus).toBe("queued");
    // While the images are being made, the next message waits.
    await expect(turn([], id, "Še nekaj").run()).rejects.toMatchObject({ code: "BUSY" });
  });

  it("a failed rewrite keeps the post's text and status and says so", async () => {
    const id = await newPost();
    await setStatus(id, "approved");
    const t = turn([route("Krajše.", ""), { input: { nope: 1 } }, { input: { nope: 2 } }], id, "Krajše prosim");
    expect(await t.run()).toEqual({ error: "TEXT_FAILED" });
    const p = await getPost(db, A, id);
    expect([p.status, p.content?.caption.startsWith("Nov tečaj je tu.")]).toEqual(["approved", true]);
    expect((await listMessages(db, A, id)).at(-1)?.meta).toEqual({ error: "TEXT_FAILED" });
  });

  it("refused: empty or too long message, a post without text, another organization's post; a provider error is answered", async () => {
    const id = await newPost();
    await expect(turn([], id, "   ").run()).rejects.toMatchObject({ code: "INVALID" });
    await expect(turn([], id, "x".repeat(2001)).run()).rejects.toMatchObject({ code: "INVALID" });
    await expect(turn([], id, "Hej", B).run()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listMessages(db, B, id)).toEqual([]);
    await setStatus(id, "generating");
    await expect(turn([], id, "Hej").run()).rejects.toMatchObject({ code: "BUSY" });
    await setStatus(id, "skipped");
    await expect(turn([], id, "Hej").run()).rejects.toMatchObject({ code: "BAD_STATE" });
    expect((await sql`select count(*)::int n from post_messages`)[0].n).toBe(0);
    await setStatus(id, "ready");
    await expect(turn([{ error: new LlmError("PROVIDER") }], id, "Hej").run()).rejects.toBeInstanceOf(ChatError);
    expect((await listMessages(db, A, id)).map((m) => [m.role, m.meta])).toEqual([["user", {}], ["assistant", { error: "FAILED" }]]);
  });

  it("a new post opens the conversation; images start in the same step when asked and possible", async () => {
    const id = await newPost();
    const q1 = queue();
    expect(await startConversation(db, { queue: q1.q }, A, id, { images: true })).toEqual({ created: true, error: "IMAGES_NO_DESIGN" });
    await withDesign();
    const id2 = await newPost();
    const q2 = queue();
    expect(await startConversation(db, { queue: q2.q }, A, id2, { images: true })).toEqual({ created: true, images: true });
    expect(q2.jobs.map((j) => j.data)).toEqual([{ postId: id2, mode: "new" }]);
    expect((await listMessages(db, A, id2)).map((m) => [m.role, m.body])).toEqual([["user", "Napovej jesenski tečaj"], ["assistant", ""]]);
    const failed = await newPost([{ error: new LlmError("PROVIDER") }]);
    expect(await startConversation(db, { queue: queue().q }, A, failed, { images: true })).toEqual({ error: "PROVIDER" });
  });
});

async function setStatus(id: string, status: string) {
  await forOrg(db, A).update(posts, { status } as never, eq(posts.id, id));
}
async function withDesign() {
  const id = crypto.randomUUID();
  await forOrg(db, A).insert(brandDesigns, { id, brandId: brandA, version: 1, status: "ready", spec: designSpecSchema.parse(cardDesign), createdBy: A.userId });
  await forOrg(db, A).update(brands, { currentDesignId: id }, eq(brands.id, brandA));
}
