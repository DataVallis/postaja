// Persona video (TASK-025): Claude's shot from the post and the DNA → first frame from the passport pictures (reference
// model, same person) → Kling 3.0 → 1080×1920 MP4 with a silent track; costs booked per step; refusals; images do
// not remove it; tenancy.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { testClip } from "../../../tests/fixtures/video";
import { createBrand, saveProfile } from "../brands/service";
import { orgSettings, posts, usageLedger, type PersonaDna } from "../db/schema";
import { createS3Storage, s3ConfigFromEnv } from "../files/storage";
import { ImageError, type ImageClient, type ImageRequest, type VideoRequest } from "../images/fal";
import { createFakeLlm } from "../llm/fake";
import { createOrganization, inviteMember } from "../orgs/service";
import { createPersonaManual, uploadPassportImage } from "../personas/service";
import type { OrgContext } from "../tenancy/context";
import { probeVideo } from "./ffmpeg";
import { listPostVideos, postVideoUrl } from "./media";
import { personaVideoEstimate, requestPersonaVideo } from "./persona";
import { runVideoJob, type PostVideoJob } from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const storage = createS3Storage(s3ConfigFromEnv());

const dna: PersonaDna = {
  gender: "Female", age: "24 years old", ethnicity: "Slovenian, fair skin with light freckles", hairStyle: "Shoulder-length, wavy", hairColour: "Copper red",
  clothing: "Olive linen shirt", mood: "Calm", environment: "Alpine lake", camera: "Mid-shot", pose: "Holding coffee", lighting: "Golden morning light",
  style: "Photorealistic digital photography", extra: "Small scar above the left eyebrow",
};
const scene = { keyframe: "Standing on a wooden pier at an alpine lake at dawn, olive linen shirt, holding a steaming cup, looking at the lake.", motion: "She turns from the lake to the camera and smiles; slow push-in." };

let A: OrgContext, B: OrgContext, editorA: OrgContext, brandA: string, postA: string, personaA: string;
beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, posts, post_media, usage_ledger, personas, persona_images cascade`;
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
  brandA = (await createBrand(db, A, { name: "Aurora", slug: "aurora", languages: ["sl"] })).id;
  await saveProfile(db, A, brandA, { cgp: "Outdoor.", rules: { bannedWords: [], ctaPhrases: [], regexMust: [], regexMustNot: [] }, pillars: [], visual: { colors: {}, imageStyle: "", negativePrompt: "" }, note: "t" });
  const [v] = await sql`select current_profile_version_id v from brands where id = ${brandA}`;
  postA = crypto.randomUUID();
  await db.insert(posts).values({ id: postA, orgId: A.orgId, brandId: brandA, profileVersionId: v.v, brief: "Jutranja kava ob jezeru", status: "ready", content: { caption: "Najlepše jutro se začne ob Bohinju ☕", hashtags: [] }, createdBy: A.userId });
  personaA = await createPersonaManual(db, A, brandA, { name: "Aurora", handle: "", dna });
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

const jpeg = (r = 200) => sharp({ create: { width: 800, height: 1000, channels: 3, background: { r, g: 120, b: 90 } } }).jpeg().toBuffer().then((b) => new Uint8Array(b));
const queue = () => { const sent: { name: string; data: PostVideoJob }[] = []; return { sent, send: async (name: string, data: object) => { sent.push({ name, data: data as PostVideoJob }); } }; };

function fakeFal(o: { videoError?: Error } = {}) {
  const images: ImageRequest[] = [];
  const videos: VideoRequest[] = [];
  const client: ImageClient = {
    async generate(req) {
      images.push(req);
      const bytes = await sharp({ create: { width: 864, height: 1536, channels: 3, background: "#557799" } }).jpeg().toBuffer();
      return { bytes: new Uint8Array(bytes), contentType: "image/jpeg", width: 864, height: 1536 };
    },
    async video(req) {
      videos.push(req);
      if (o.videoError) throw o.videoError;
      return { bytes: testClip({ width: 720, height: 1280, seconds: 3 }) };
    },
  };
  return { client, images, videos };
}
const claude = () => createFakeLlm([{ input: scene }]);

describe("persona video", () => {
  it("needs a persona with pictures; any member can ask; 5 or 10 s only", async () => {
    await expect(requestPersonaVideo(db, queue(), A, postA, { durationS: 5 })).rejects.toMatchObject({ code: "NO_PERSONA" });
    await uploadPassportImage(db, storage, A, personaA, { filename: "a.jpg", bytes: await jpeg() });
    await expect(requestPersonaVideo(db, queue(), A, postA, { durationS: 7 as 5 })).rejects.toMatchObject({ code: "INVALID" });
    await expect(requestPersonaVideo(db, queue(), B, postA, { durationS: 5 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const q = queue();
    await requestPersonaVideo(db, q, editorA, postA, { durationS: 10, wish: "na pomolu" });
    await expect(requestPersonaVideo(db, q, A, postA, { durationS: 5 })).rejects.toMatchObject({ code: "BAD_STATE" });
    expect(q.sent).toEqual([{ name: "post-video", data: { postId: postA } }]);
    const [p] = await db.select().from(posts).where(eq(posts.id, postA));
    expect(p).toMatchObject({ videoStatus: "queued", videoMode: "persona", videoDurationS: 10, videoMotion: "na pomolu", videoRequestedBy: editorA.userId });
  });

  it("shot by Claude → first frame from the passport (primary first) → Kling 3.0 → 1080×1920 MP4; each step booked", async () => {
    await uploadPassportImage(db, storage, A, personaA, { filename: "a.jpg", bytes: await jpeg() }, "front");
    await uploadPassportImage(db, storage, A, personaA, { filename: "b.jpg", bytes: await jpeg(20) }, "profile");
    // Kling 3.0 Standard $0.084/s × 5 + Nano Banana Pro edit $0.15 + the scene call (with a retry) at most.
    const est = (await personaVideoEstimate(db, brandA, 5))!;
    expect(est).toBeGreaterThan(84_000n * 5n + 150_000n);
    const q = queue();
    await requestPersonaVideo(db, q, A, postA, { durationS: 5, wish: "na pomolu" });
    const llm = claude();
    const fal = fakeFal();
    expect(await runVideoJob(db, { llm: llm.client, storage, images: fal.client }, q.sent[0].data)).toBe("done");

    expect(llm.requests[0].tool.name).toBe("submit_persona_scene");
    expect(llm.requests[0].user).toContain("Najlepše jutro se začne ob Bohinju");
    expect(llm.requests[0].user).toContain("Hair Colour: Copper red");
    expect(llm.requests[0].user).toContain("na pomolu");
    expect(fal.images).toHaveLength(1);
    expect(fal.images[0].model).toBe("fal-ai/nano-banana-pro/edit");
    expect(fal.images[0].references).toHaveLength(2);
    expect(fal.images[0].width / fal.images[0].height).toBeCloseTo(9 / 16, 1);
    expect(fal.images[0].prompt).toContain("SAME person as in the reference images");
    expect(fal.images[0].prompt).toContain(scene.keyframe);
    expect(fal.images[0].prompt).toContain("Small scar above the left eyebrow");
    expect(fal.videos).toEqual([expect.objectContaining({ model: "fal-ai/kling-video/v3/standard/image-to-video", durationS: 5 })]);
    expect(fal.videos[0].prompt).toContain(scene.motion);
    expect(fal.videos[0].image).toMatch(/^data:image\/jpeg;base64,/);

    const [video] = await listPostVideos(db, A, postA, "persona");
    expect(video).toMatchObject({ width: 1080, height: 1920, kind: "persona", spec: scene, model: "fal-ai/kling-video/v3/standard/image-to-video" });
    const probe = await probeVideo(await storage.get(video.storageKey));
    // TASK-045: the video says it shows an AI person.
    const tmp = path.join(os.tmpdir(), `persona-${Date.now()}.mp4`);
    fs.writeFileSync(tmp, await storage.get(video.storageKey));
    const tags = spawnSync("ffprobe", ["-v", "quiet", "-show_entries", "format_tags=comment", "-of", "default=nw=1:nk=1", tmp], { encoding: "utf8" }).stdout;
    fs.rmSync(tmp, { force: true });
    expect(tags).toContain("AI-generated person");
    expect(probe).toMatchObject({ width: 1080, height: 1920, codec: "h264" });
    expect(video.posterKey).not.toBeNull();
    expect(await postVideoUrl(db, storage, A, video.id, { download: true, poster: true })).toContain(".jpg");
    await expect(postVideoUrl(db, storage, B, video.id, { download: false, poster: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await db.select().from(posts).where(eq(posts.id, postA)))[0]).toMatchObject({ videoStatus: "ready", videoError: null });

    const ledger = await db.select().from(usageLedger);
    expect(ledger.every((l) => l.state === "settled" && l.postId === postA)).toBe(true);
    expect(ledger).toHaveLength(3);
    expect(ledger.map((l) => l.provider).sort()).toEqual(["anthropic", "fal", "fal"]);
    expect(ledger.map((l) => l.model)).toEqual(expect.arrayContaining(["fal-ai/kling-video/v3/standard/image-to-video", "fal-ai/nano-banana-pro/edit"]));
    expect(ledger.find((l) => l.model.includes("kling"))!.costMicroUsd).toBe(420_000n);
  });

  it("a second persona video is added next to the first (TASK-032: nothing made is removed)", async () => {
    await uploadPassportImage(db, storage, A, personaA, { filename: "a.jpg", bytes: await jpeg() });
    for (let i = 0; i < 2; i++) {
      const q = queue();
      await requestPersonaVideo(db, q, A, postA, { durationS: 5 });
      expect(await runVideoJob(db, { llm: claude().client, storage, images: fakeFal().client }, q.sent[0].data)).toBe("done");
    }
    const all = await listPostVideos(db, A, postA);
    expect(all).toHaveLength(2);
    for (const v of all) expect(await storage.exists(v.storageKey)).toBe(true);
  });

  it("a provider failure on the clip releases its reservation and records the reason; the frame stays paid", async () => {
    await uploadPassportImage(db, storage, A, personaA, { filename: "a.jpg", bytes: await jpeg() });
    const q = queue();
    await requestPersonaVideo(db, q, A, postA, { durationS: 5 });
    const fal = fakeFal({ videoError: new ImageError("IMAGE_BLOCKED") });
    expect(await runVideoJob(db, { llm: claude().client, storage, images: fal.client }, q.sent[0].data)).toBe("failed");
    expect((await db.select().from(posts).where(eq(posts.id, postA)))[0]).toMatchObject({ videoStatus: "failed", videoError: "IMAGE_BLOCKED" });
    const ledger = await db.select().from(usageLedger);
    expect(ledger.some((l) => l.model.includes("kling"))).toBe(false);
    expect(ledger.some((l) => l.model.includes("nano-banana"))).toBe(true);
    expect(await listPostVideos(db, A, postA)).toEqual([]);
  });

  it("the spend cap stops it before the first paid call", async () => {
    await uploadPassportImage(db, storage, A, personaA, { filename: "a.jpg", bytes: await jpeg() });
    await db.update(orgSettings).set({ spendCapMicroUsd: 1_000n }).where(eq(orgSettings.orgId, A.orgId));
    const q = queue();
    await requestPersonaVideo(db, q, A, postA, { durationS: 5 });
    const fal = fakeFal();
    const llm = claude();
    expect(await runVideoJob(db, { llm: llm.client, storage, images: fal.client }, q.sent[0].data)).toBe("failed");
    expect(llm.requests).toHaveLength(0);
    expect(fal.images).toHaveLength(0);
    expect((await db.select().from(posts).where(eq(posts.id, postA)))[0].videoError).toBe("SPEND_CAP");
  });
});
