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
  const deps = (images: ImageClient) => ({ llm: createFakeLlm().client, storage, images });

  it("one photoreal passport close-up from the whole DNA with Nano Banana Pro; booked on the brand", async () => {
    const id = await manual();
    expect(await passportEstimate(db, A, id)).toEqual({ replaces: false, maxCost: 150_000n });
    const q = queue();
    await requestPassport(db, q, A, id);
    await expect(requestPassport(db, q, A, id)).rejects.toMatchObject({ code: "BAD_STATE" });
    expect(q.sent).toEqual([{ name: "persona-passport", data: { personaId: id } }]);

    const images = fakeImages();
    expect(await runPassportJob(db, deps(images.client), q.sent[0].data)).toBe("done");
    expect(images.requests).toHaveLength(1);
    const [r] = images.requests;
    expect(r).toMatchObject({ model: "fal-ai/nano-banana-pro", references: undefined });
    expect(r.width / r.height).toBeCloseTo(0.8, 2);
    // The whole DNA, the passport close-up, and real-photo cues.
    for (const v of Object.values(dna)) expect(r.prompt).toContain(v);
    expect(r.prompt).toContain("Passport-style close-up");
    expect(r.prompt).toContain("indistinguishable from reality");
    expect(r.prompt).toContain("No text");

    const got = (await getBrandPersona(db, A, brandA))!;
    expect(got.persona.passportStatus).toBe("ready");
    expect(got.images.map((i) => [i.angle, i.isPrimary, i.source, i.model])).toEqual([["front", true, "generated", "fal-ai/nano-banana-pro"]]);
    const ledger = await db.select().from(usageLedger);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ state: "settled", brandId: brandA, postId: null, costMicroUsd: 150_000n, model: "fal-ai/nano-banana-pro" });
    expect(await passportEstimate(db, A, id)).toEqual({ replaces: true, maxCost: 150_000n });
  });

  it("a new passport picture replaces the previous generated one (primary stays with it); uploads stay", async () => {
    const id = await manual();
    const q = queue();
    const images = fakeImages();
    await requestPassport(db, q, A, id);
    await runPassportJob(db, deps(images.client), q.sent[0].data);
    const up = await uploadPassportImage(db, storage, A, id, { filename: "mine.jpg", bytes: await jpeg() }, "smile");
    const first = (await getBrandPersona(db, A, brandA))!.images.find((i) => i.source === "generated")!;
    await requestPassport(db, q, A, id);
    await runPassportJob(db, deps(images.client), q.sent[1].data);
    const imgs = (await getBrandPersona(db, A, brandA))!.images;
    expect(imgs).toHaveLength(2);
    expect(imgs.map((i) => i.id)).not.toContain(first.id);
    expect(imgs[0]).toMatchObject({ angle: "front", source: "generated", isPrimary: true });
    expect(imgs[1]).toMatchObject({ id: up, isPrimary: false });
    // With the upload as primary, a new passport does not take it over.
    await setPrimaryImage(db, A, up);
    await requestPassport(db, q, A, id);
    await runPassportJob(db, deps(images.client), q.sent[2].data);
    expect((await getBrandPersona(db, A, brandA))!.images.map((i) => [i.source, i.isPrimary])).toEqual([["uploaded", true], ["generated", false]]);
  });

  it("a refusal is recorded with the provider's reason; the reservation is released", async () => {
    const id = await manual();
    const q = queue();
    await requestPassport(db, q, A, id);
    const images = fakeImages(() => new ImageError("IMAGE_BLOCKED", "Content policy violation"));
    expect(await runPassportJob(db, deps(images.client), q.sent[0].data)).toBe("failed");
    const got = (await getBrandPersona(db, A, brandA))!;
    expect(got.persona).toMatchObject({ passportStatus: "failed", passportError: "IMAGE_BLOCKED:Content policy violation" });
    expect(got.images).toEqual([]);
    expect(await db.select().from(usageLedger)).toEqual([]);
  });

  it("a full passport (10 own pictures) has no room; the spend cap stops it before any call; editors cannot; a demoted owner's job fails", async () => {
    const id = await manual();
    await expect(requestPassport(db, queue(), editorA, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.update(orgSettings).set({ spendCapMicroUsd: 10_000n }).where(eq(orgSettings.orgId, A.orgId));
    const q = queue();
    await requestPassport(db, q, A, id);
    const images = fakeImages();
    expect(await runPassportJob(db, deps(images.client), q.sent[0].data)).toBe("failed");
    expect(images.requests).toHaveLength(0);
    expect((await getBrandPersona(db, A, brandA))!.persona.passportError).toBe("SPEND_CAP");

    await db.update(orgSettings).set({ spendCapMicroUsd: 100_000_000n }).where(eq(orgSettings.orgId, A.orgId));
    await requestPassport(db, q, A, id);
    await sql`update member set role = 'editor' where user_id = ${A.userId} and organization_id = ${A.orgId}`;
    expect(await runPassportJob(db, deps(images.client), q.sent[1].data)).toBe("failed");
    expect((await getBrandPersona(db, A, brandA))!.persona.passportError).toBe("NO_ACCESS");
    await sql`update member set role = 'owner' where user_id = ${A.userId} and organization_id = ${A.orgId}`;

    for (let n = 0; n < 10; n++) await uploadPassportImage(db, storage, A, id, { filename: `${n}.jpg`, bytes: await jpeg(600, 750, 10 + n * 20) });
    await expect(requestPassport(db, queue(), A, id)).rejects.toMatchObject({ code: "LIMIT_REACHED" });
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
