// Personas (TASK-024): DNA by hand or filled in by Claude, passport uploads (primary rules, limits, duplicates),
// passport generation (the first picture from the whole DNA, the other angles with the persona as reference), cost
// booking and refusals, roles and tenancy.
import { eq } from "drizzle-orm";
import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { crossTenantSuite } from "../../../tests/tenancy/harness";
import { createBrand, saveProfile, setBrandArchived } from "../brands/service";
import { orgSettings, personaImages, personas, usageLedger, type PersonaDna } from "../db/schema";
import { createS3Storage, s3ConfigFromEnv } from "../files/storage";
import { ImageError, type ImageClient, type ImageRequest } from "../images/fal";
import { createFakeLlm } from "../llm/fake";
import { createOrganization, inviteMember } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { handlePassportImage, handlePassportUpload } from "./http";
import {
  createPersona, createPersonaManual, deletePassportImage, deletePersona, getBrandPersona, passportEstimate, passportImageUrl, PersonaError,
  requestPassport, runPassportJob, setPrimaryImage, updatePersona, uploadPassportImage, type PassportJob,
} from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const storage = createS3Storage(s3ConfigFromEnv());

const dna: PersonaDna = {
  gender: "Female", age: "24 years old", ethnicity: "Slovenian, fair skin with light freckles", hairStyle: "Shoulder-length, wavy, side-parted",
  hairColour: "Copper red", clothing: "Olive linen shirt, small gold hoops", mood: "Calm and curious", environment: "Alpine lake shore at dawn",
  camera: "Mid-shot, eye-level", pose: "Holding a coffee cup with both hands", lighting: "Soft golden morning light", style: "Photorealistic digital photography",
  extra: "Small scar above the left eyebrow; green eyes",
};

let A: OrgContext, B: OrgContext, editorA: OrgContext, brandA: string, brandB: string;
beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, usage_ledger, personas, persona_images cascade`;
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
  brandB = (await createBrand(db, B, { name: "Other", slug: "other", languages: ["sl"] })).id;
  await saveProfile(db, A, brandA, {
    cgp: "Aurora je AI influencerka za outdoor opremo.\n\n## Persona DNA\nRada ima gore in kavo.", rules: { bannedWords: [], ctaPhrases: [], regexMust: [], regexMustNot: [] },
    pillars: [], visual: { colors: {}, imageStyle: "", negativePrompt: "" }, note: "t",
  });
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

const jpeg = (w = 600, h = 750, r = 200) => sharp({ create: { width: w, height: h, channels: 3, background: { r, g: 120, b: 90 } } }).jpeg().toBuffer().then((b) => new Uint8Array(b));

/** Records every request; returns a distinct picture each time (so the passport has no duplicates). */
function fakeImages(fail?: (n: number) => Error | null) {
  const requests: ImageRequest[] = [];
  const client: ImageClient = {
    async generate(req) {
      requests.push(req);
      const err = fail?.(requests.length);
      if (err) throw err;
      const bytes = await sharp({ create: { width: req.width, height: req.height, channels: 3, background: { r: (requests.length * 37) % 255, g: 80, b: 140 } } }).jpeg().toBuffer();
      return { bytes: new Uint8Array(bytes), contentType: "image/jpeg", width: req.width, height: req.height };
    },
  };
  return { client, requests };
}

const manual = (brandId = brandA, ctx = A) => createPersonaManual(db, ctx, brandId, { name: "Aurora", handle: "@aurora.alps", dna });

describe("creating a persona", () => {
  it("by hand: the framework's fields, the handle without @; one persona per brand", async () => {
    const id = await manual();
    const got = await getBrandPersona(db, A, brandA);
    expect(got).toMatchObject({ persona: { id, name: "Aurora", handle: "aurora.alps", dna, passportStatus: "none" }, images: [] });
    await expect(manual()).rejects.toMatchObject({ code: "EXISTS" });
  });

  it("by hand needs gender, age, ethnicity and hair colour", async () => {
    await expect(createPersonaManual(db, A, brandA, { name: "X", handle: "", dna: { ...dna, hairColour: " " } })).rejects.toMatchObject({ code: "INVALID" });
  });

  it("with AI: Claude gets the owner's text and the CGP's persona section, and fills every field", async () => {
    const llm = createFakeLlm([{ input: { name: "Aurora", dna } }]);
    const id = await createPersona(db, { llm: llm.client }, A, brandA, { name: "", text: "25-letna Slovenka, rdeči lasje, ljubi gore" });
    expect(llm.requests[0].tool.name).toBe("submit_persona_dna");
    expect(llm.requests[0].user).toContain("25-letna Slovenka, rdeči lasje, ljubi gore");
    expect(llm.requests[0].user).toContain("Rada ima gore in kavo.");
    expect(llm.requests[0].system[0].text).toContain("Ethnicity / Skin Tone");
    const [p] = await db.select().from(personas).where(eq(personas.id, id));
    expect(p).toMatchObject({ name: "Aurora", dna });
    // The Claude call is booked on the brand.
    const ledger = await db.select().from(usageLedger);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ brandId: brandA, postId: null, state: "settled" });
  });

  it("with AI: an answer without the identity fields is refused and nothing is stored", async () => {
    const llm = createFakeLlm([{ input: { name: "A", dna: { ...dna, gender: "" } } }]);
    await expect(createPersona(db, { llm: llm.client }, A, brandA, { text: "nekaj o osebi" })).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
    expect(await getBrandPersona(db, A, brandA)).toBeNull();
  });

  it("only the owner, not on an archived brand, not on another org's brand", async () => {
    await expect(manual(brandA, editorA)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(manual(brandB, A)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await setBrandArchived(db, A, brandA, true);
    await expect(manual()).rejects.toMatchObject({ code: "ARCHIVED" });
  });

  it("the owner edits the DNA; members only read", async () => {
    const id = await manual();
    await updatePersona(db, A, id, { name: "Aurora K.", handle: "aurora", dna: { ...dna, hairColour: "Auburn" } });
    expect((await getBrandPersona(db, editorA, brandA))!.persona).toMatchObject({ name: "Aurora K.", dna: { hairColour: "Auburn" } });
    await expect(updatePersona(db, editorA, id, { name: "x", handle: "", dna })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updatePersona(db, B, id, { name: "x", handle: "", dna })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("passport uploads", () => {
  it("re-encoded; the first becomes primary; duplicates and an 11th refused; primary moves on delete", async () => {
    const id = await manual();
    const first = await uploadPassportImage(db, storage, A, id, { filename: "../front.jpg", bytes: await jpeg() }, "front");
    await expect(uploadPassportImage(db, storage, A, id, { filename: "again.jpg", bytes: await jpeg() })).rejects.toMatchObject({ code: "DUPLICATE" });
    const second = await uploadPassportImage(db, storage, A, id, { filename: "b.jpg", bytes: await jpeg(600, 750, 10) }, "profile");
    let imgs = (await getBrandPersona(db, A, brandA))!.images;
    expect(imgs.map((i) => [i.id, i.isPrimary, i.angle, i.source, i.filename])).toEqual([[first, true, "front", "uploaded", "front.jpg"], [second, false, "profile", "uploaded", "b.jpg"]]);

    await setPrimaryImage(db, A, second);
    imgs = (await getBrandPersona(db, A, brandA))!.images;
    expect(imgs[0]).toMatchObject({ id: second, isPrimary: true });
    expect(imgs.filter((i) => i.isPrimary)).toHaveLength(1);

    await deletePassportImage(db, storage, A, second);
    imgs = (await getBrandPersona(db, A, brandA))!.images;
    expect(imgs.map((i) => [i.id, i.isPrimary])).toEqual([[first, true]]);

    for (let n = 0; n < 9; n++) await uploadPassportImage(db, storage, A, id, { filename: `${n}.jpg`, bytes: await jpeg(600, 750, 20 + n * 20) });
    await expect(uploadPassportImage(db, storage, A, id, { filename: "11.jpg", bytes: await jpeg(600, 750, 250) })).rejects.toMatchObject({ code: "LIMIT_REACHED" });
  });

  it("refuses non-images, tiny pictures, a bad angle; editors and other orgs cannot upload", async () => {
    const id = await manual();
    await expect(uploadPassportImage(db, storage, A, id, { filename: "x.jpg", bytes: new TextEncoder().encode("not an image") })).rejects.toMatchObject({ code: "INVALID_FILE" });
    await expect(uploadPassportImage(db, storage, A, id, { filename: "s.jpg", bytes: await jpeg(100, 100) })).rejects.toMatchObject({ code: "INVALID_FILE" });
    await expect(uploadPassportImage(db, storage, A, id, { filename: "a.jpg", bytes: await jpeg() }, "selfie")).rejects.toMatchObject({ code: "INVALID" });
    await expect(uploadPassportImage(db, storage, editorA, id, { filename: "a.jpg", bytes: await jpeg() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(uploadPassportImage(db, storage, B, id, { filename: "a.jpg", bytes: await jpeg() })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("HTTP: same origin and owner only; pictures shown to members of the org only", async () => {
    const id = await manual();
    const deps = { db, storage, appOrigin: "http://localhost:3000" };
    const form = async () => { const f = new FormData(); f.append("file", new File([await jpeg()], "p.jpg", { type: "image/jpeg" })); f.append("angle", "front"); return f; };
    const req = async (origin: string) => {
      const body = new Request("http://x", { method: "POST", body: await form() });
      const bytes = await body.arrayBuffer();
      return new Request(`http://localhost:3000/api/personas/${id}/images`, { method: "POST", body: bytes, headers: { origin, "content-type": body.headers.get("content-type")!, "content-length": String(bytes.byteLength) } });
    };
    expect((await handlePassportUpload(await req("https://evil.example"), id, { ...deps, getCtx: async () => A })).status).toBe(403);
    expect((await handlePassportUpload(await req("http://localhost:3000"), id, { ...deps, getCtx: async () => editorA })).status).toBe(403);
    const ok = await handlePassportUpload(await req("http://localhost:3000"), id, { ...deps, getCtx: async () => A });
    expect(ok.status).toBe(201);
    const { id: imageId } = (await ok.json()) as { id: string };
    const show = await handlePassportImage(new Request(`http://localhost:3000/api/persona-images/${imageId}`), imageId, { db, storage, getCtx: async () => editorA });
    expect(show.status).toBe(302);
    expect(show.headers.get("location")).toContain("aurora-front.jpg");
    expect((await handlePassportImage(new Request("http://x/"), imageId, { db, storage, getCtx: async () => B })).status).toBe(404);
    expect((await handlePassportImage(new Request("http://x/"), imageId, { db, storage, getCtx: async () => null })).status).toBe(401);
  });
});

describe("passport generation", () => {
  const queue = () => { const sent: { name: string; data: PassportJob }[] = []; return { sent, send: async (name: string, data: object) => { sent.push({ name, data: data as PassportJob }); } }; };

  it("from nothing: a passport picture from the whole DNA (text-to-image), then 4 angles with the persona as reference", async () => {
    const id = await manual();
    const est = await passportEstimate(db, A, id);
    // FLUX 1.1 pro (1 MP × $0.04) + 4 × Nano Banana edit ($0.039).
    expect(est).toEqual({ count: 5, maxCost: 40_000n + 4n * 39_000n });
    const q = queue();
    await requestPassport(db, q, A, id);
    await expect(requestPassport(db, q, A, id)).rejects.toMatchObject({ code: "BAD_STATE" });
    expect(q.sent).toEqual([{ name: "persona-passport", data: { personaId: id } }]);

    const images = fakeImages();
    expect(await runPassportJob(db, { llm: createFakeLlm().client, storage, images: images.client }, q.sent[0].data)).toBe("done");
    expect(images.requests.map((r) => [r.model, r.references?.length ?? 0])).toEqual([
      ["fal-ai/flux-pro/v1.1", 0], ["fal-ai/nano-banana/edit", 1], ["fal-ai/nano-banana/edit", 2], ["fal-ai/nano-banana/edit", 3], ["fal-ai/nano-banana/edit", 4],
    ]);
    const first = images.requests[0].prompt;
    // The first prompt includes the DNA (all but camera and pose, which the passport framing replaces) and no text.
    for (const v of [dna.gender, dna.age, dna.ethnicity, dna.hairStyle, dna.hairColour, dna.clothing, dna.mood, dna.environment, dna.lighting, dna.style, dna.extra]) expect(first).toContain(v);
    expect(first).toContain("Passport-style portrait");
    expect(first).not.toContain(dna.pose);
    expect(first).toContain("No text");
    expect(images.requests[1].prompt).toContain("SAME person as in the reference images");
    expect(images.requests[4].prompt).toContain("Full-body");
    expect(images.requests[1].references![0]).toMatch(/^data:image\/jpeg;base64,/);

    const got = (await getBrandPersona(db, A, brandA))!;
    expect(got.persona.passportStatus).toBe("ready");
    expect(got.images.map((i) => [i.angle, i.isPrimary, i.source])).toEqual([
      ["front", true, "generated"], ["three_quarter", false, "generated"], ["profile", false, "generated"], ["smile", false, "generated"], ["full_body", false, "generated"],
    ]);
    expect(got.images[1].model).toBe("fal-ai/nano-banana/edit");
    const ledger = await db.select().from(usageLedger);
    expect(ledger.every((l) => l.state === "settled" && l.brandId === brandA && l.postId === null)).toBe(true);
    expect(ledger.reduce((s, l) => s + l.costMicroUsd, 0n)).toBe(40_000n + 4n * 39_000n);
    expect(await passportEstimate(db, A, id)).toEqual({ count: 0, maxCost: 0n });
    await expect(requestPassport(db, q, A, id)).rejects.toMatchObject({ code: "NOTHING_TO_DO" });
  });

  it("with the owner's own pictures: no new front picture, only the missing angles from the uploads", async () => {
    const id = await manual();
    await uploadPassportImage(db, storage, A, id, { filename: "a.jpg", bytes: await jpeg() });
    await uploadPassportImage(db, storage, A, id, { filename: "b.jpg", bytes: await jpeg(600, 750, 10) }, "smile");
    expect(await passportEstimate(db, A, id)).toEqual({ count: 3, maxCost: 3n * 39_000n });
    const q = queue();
    await requestPassport(db, q, A, id);
    const images = fakeImages();
    await runPassportJob(db, { llm: createFakeLlm().client, storage, images: images.client }, q.sent[0].data);
    expect(images.requests.map((r) => r.references?.length)).toEqual([2, 3, 4]);
    expect((await getBrandPersona(db, A, brandA))!.images.map((i) => i.angle).sort()).toEqual(["full_body", "other", "profile", "smile", "three_quarter"]);
  });

  it("a provider error keeps what was made, releases the reservation and records the failure", async () => {
    const id = await manual();
    const q = queue();
    await requestPassport(db, q, A, id);
    const images = fakeImages((n) => (n === 3 ? new ImageError("IMAGE_BLOCKED") : null));
    expect(await runPassportJob(db, { llm: createFakeLlm().client, storage, images: images.client }, q.sent[0].data)).toBe("failed");
    const got = (await getBrandPersona(db, A, brandA))!;
    expect(got.persona).toMatchObject({ passportStatus: "failed", passportError: "IMAGE_BLOCKED" });
    expect(got.images).toHaveLength(2);
    expect((await db.select().from(usageLedger)).every((l) => l.state === "settled")).toBe(true);
    // Trying again fills only what is missing.
    expect(await passportEstimate(db, A, id)).toMatchObject({ count: 3 });
  });

  it("the spend cap stops it before any call; an editor cannot start it; a demoted owner's job fails", async () => {
    const id = await manual();
    await expect(requestPassport(db, queue(), editorA, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.update(orgSettings).set({ spendCapMicroUsd: 10_000n }).where(eq(orgSettings.orgId, A.orgId));
    const q = queue();
    await requestPassport(db, q, A, id);
    const images = fakeImages();
    expect(await runPassportJob(db, { llm: createFakeLlm().client, storage, images: images.client }, q.sent[0].data)).toBe("failed");
    expect(images.requests).toHaveLength(0);
    expect((await getBrandPersona(db, A, brandA))!.persona.passportError).toBe("SPEND_CAP");

    await db.update(orgSettings).set({ spendCapMicroUsd: 100_000_000n }).where(eq(orgSettings.orgId, A.orgId));
    await requestPassport(db, q, A, id);
    await sql`update member set role = 'editor' where user_id = ${A.userId} and organization_id = ${A.orgId}`;
    expect(await runPassportJob(db, { llm: createFakeLlm().client, storage, images: images.client }, q.sent[1].data)).toBe("failed");
    expect((await getBrandPersona(db, A, brandA))!.persona.passportError).toBe("NO_ACCESS");
  });
});

describe("deleting", () => {
  it("the persona with its pictures (owner only)", async () => {
    const id = await manual();
    const img = await uploadPassportImage(db, storage, A, id, { filename: "a.jpg", bytes: await jpeg() });
    await expect(deletePersona(db, storage, editorA, id)).rejects.toBeInstanceOf(PersonaError);
    await deletePersona(db, storage, A, id);
    expect(await getBrandPersona(db, A, brandA)).toBeNull();
    expect(await db.select().from(personaImages)).toEqual([]);
    await expect(passportImageUrl(db, storage, A, img, false)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("tenancy", () => {
  crossTenantSuite({
    name: "personas",
    scopes: () => ({ a: forOrg(db, A), b: forOrg(db, B) }),
    seedInA: async () => manual(),
    read: (s, id) => s.select(personas, eq(personas.id, id)),
    update: (s, id) => s.update(personas, { name: "hacked" }, eq(personas.id, id)),
    remove: (s, id) => s.delete(personas, eq(personas.id, id)),
    raw: async (id) => (await db.select().from(personas).where(eq(personas.id, id)))[0],
  });
  crossTenantSuite({
    name: "persona_images",
    scopes: () => ({ a: forOrg(db, A), b: forOrg(db, B) }),
    seedInA: async () => uploadPassportImage(db, storage, A, await manual(), { filename: "a.jpg", bytes: await jpeg() }),
    read: (s, id) => s.select(personaImages, eq(personaImages.id, id)),
    update: (s, id) => s.update(personaImages, { isPrimary: false }, eq(personaImages.id, id)),
    remove: (s, id) => s.delete(personaImages, eq(personaImages.id, id)),
    raw: async (id) => (await db.select().from(personaImages).where(eq(personaImages.id, id)))[0],
  });
});
