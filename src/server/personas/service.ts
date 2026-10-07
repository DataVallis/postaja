// Personas (TASK-024, spec §5.5, ADR-053): an AI influencer of a brand. The owner creates one from a brief or imports
// an existing DNA (Claude structures it), edits the DNA fields, and builds the passport: uploads pictures of the person
// and/or lets Postaja generate the standard set (front portrait from the DNA, then the other angles with a reference
// model from the pictures already there, so it stays the same person). Members see it; the owner changes it.
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, lt, ne, or } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import type { Db } from "../db/client";
import { brands, DNA_FIELDS, modelRegistry, PASSPORT_ANGLES, personaImages, personas, usageLedger, type PassportAngle, type PersonaDna } from "../db/schema";
import { cleanFilename, storageKey } from "../brands/files";
import { getBrandDetail } from "../brands/service";
import { MAX_INPUT_PIXELS, reencodeImage } from "../files/images";
import { sniff } from "../files/sniff";
import type { Storage } from "../files/storage";
import { billedMegapixels, generationSize, ImageError } from "../images/fal";
import type { ImageDeps } from "../images/service";
import { cappedCall, textModelFor } from "../llm/call";
import { worstCaseMicroUsd } from "../llm/cost";
import { reserve, release, SpendCapError } from "../llm/spend";
import { LlmError } from "../llm/types";
import { resolveOrgContext, TenancyError, type OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { dnaBlock, dnaComplete, dnaRequest, dnaToolSchema, DNA_TEXT_MAX, FIELD_MAX, personaDnaSchema } from "./dna";

export const PERSONA_PASSPORT_QUEUE = "persona-passport";
export type PassportJob = { personaId: string };
export const MAX_PASSPORT = 10;
export const MAX_PASSPORT_BYTES = 15 * 1024 * 1024;
const STALE_MS = 15 * 60 * 1000;

export class PersonaError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "NOT_FOUND" | "ARCHIVED" | "EXISTS" | "INVALID" | "INVALID_OUTPUT" | "BAD_STATE" | "LIMIT_REACHED" | "DUPLICATE" | "INVALID_FILE" | "TOO_LARGE" | "NOTHING_TO_DO" | "NO_REF_MODEL") {
    super(code);
  }
}

type PersonaRow = typeof personas.$inferSelect;
type ImageRow = typeof personaImages.$inferSelect;
type Queue = { send(name: string, data: object, key: string): Promise<void> };

function requireOwner(ctx: OrgContext) {
  if (ctx.role !== "owner") throw new PersonaError("FORBIDDEN");
}

async function brandFor(db: Db, ctx: OrgContext, brandId: string, write: boolean) {
  const [b] = (await forOrg(db, ctx).select(brands, eq(brands.id, brandId))) as (typeof brands.$inferSelect)[];
  if (!b) throw new PersonaError("NOT_FOUND");
  if (write && b.archivedAt) throw new PersonaError("ARCHIVED");
  return b;
}

async function personaById(db: Db, ctx: OrgContext, id: string): Promise<PersonaRow> {
  const [p] = (await forOrg(db, ctx).select(personas, eq(personas.id, id))) as PersonaRow[];
  if (!p) throw new PersonaError("NOT_FOUND");
  return p;
}

/** The brand's persona with its passport (primary first, then in the standard order), or null. Any member. */
export async function getBrandPersona(db: Db, ctx: OrgContext, brandId: string) {
  const [p] = (await forOrg(db, ctx).select(personas, eq(personas.brandId, brandId))) as PersonaRow[];
  if (!p) return null;
  return { persona: p, images: await passportImages(db, ctx, p.id) };
}

const ORDER: Record<PassportAngle, number> = { front: 0, three_quarter: 1, profile: 2, smile: 3, full_body: 4, other: 5 };
async function passportImages(db: Db, ctx: OrgContext, personaId: string): Promise<ImageRow[]> {
  const rows = (await db.select().from(personaImages)
    .where(and(eq(personaImages.orgId, ctx.orgId), eq(personaImages.personaId, personaId)))
    .orderBy(asc(personaImages.createdAt))) as ImageRow[];
  return rows.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || ORDER[a.angle] - ORDER[b.angle]);
}

/** What Claude knows of the brand: the CGP's persona section when it has one, else its beginning. */
function brandContext(cgp: string): string {
  const at = cgp.search(/persona\s+dna|ai[- ]influencer|persona/i);
  return at > 0 ? `${cgp.slice(0, 1200)}\n…\n${cgp.slice(at, at + 3500)}` : cgp.slice(0, 4000);
}

const textInput = z.object({ name: z.string().trim().max(80).default(""), text: z.string().trim().min(10).max(DNA_TEXT_MAX) });
const dnaInput = z.object(Object.fromEntries(DNA_FIELDS.map((f) => [f, z.string().trim().max(FIELD_MAX).default("")])) as Record<(typeof DNA_FIELDS)[number], z.ZodDefault<z.ZodString>>);
const manualInput = z.object({ name: z.string().trim().min(1).max(80), handle: z.string().trim().max(60).default(""), dna: dnaInput });

async function insertPersona(db: Db, ctx: OrgContext, brandId: string, v: { name: string; handle: string; dna: PersonaDna }) {
  const id = crypto.randomUUID();
  try {
    await forOrg(db, ctx).insert(personas, { id, brandId, name: v.name, handle: v.handle.replace(/^@/, ""), dna: v.dna, createdBy: ctx.userId });
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    if (err?.code === "23505" || err?.cause?.code === "23505") throw new PersonaError("EXISTS");
    throw e;
  }
  return id;
}

async function assertNoPersona(db: Db, ctx: OrgContext, brandId: string) {
  if ((await forOrg(db, ctx).select(personas, eq(personas.brandId, brandId))).length) throw new PersonaError("EXISTS");
}

/** Owner fills in the DNA by hand (gender, age, ethnicity/skin and hair colour are required). */
export async function createPersonaManual(db: Db, ctx: OrgContext, brandId: string, input: z.input<typeof manualInput>) {
  requireOwner(ctx);
  const data = manualInput.safeParse(input);
  if (!data.success || !dnaComplete(data.data.dna as PersonaDna)) throw new PersonaError("INVALID");
  await brandFor(db, ctx, brandId, true);
  await assertNoPersona(db, ctx, brandId);
  return insertPersona(db, ctx, brandId, { name: data.data.name, handle: data.data.handle, dna: data.data.dna as PersonaDna });
}

/** Owner describes the person roughly (or pastes/imports a DNA); Claude fills in every field of the framework. */
export async function createPersona(db: Db, deps: Pick<ImageDeps, "llm" | "now">, ctx: OrgContext, brandId: string, input: z.input<typeof textInput>) {
  requireOwner(ctx);
  const data = textInput.safeParse(input);
  if (!data.success) throw new PersonaError("INVALID");
  const brand = await brandFor(db, ctx, brandId, true);
  await assertNoPersona(db, ctx, brandId);
  const { profile } = await getBrandDetail(db, ctx, brandId);
  const out = await cappedCall(db, deps.llm, { orgId: ctx.orgId, brandId, postId: null, now: deps.now },
    dnaRequest({ text: data.data.text, name: data.data.name, brandName: brand.name, brandContext: brandContext(profile?.cgp ?? "") }));
  const parsed = dnaToolSchema.safeParse(out.input);
  if (!parsed.success || !dnaComplete(parsed.data.dna)) throw new PersonaError("INVALID_OUTPUT");
  return insertPersona(db, ctx, brandId, { name: data.data.name || parsed.data.name, handle: "", dna: parsed.data.dna });
}

const updateInput = manualInput;

/** Owner edits the name, handle and any DNA field. */
export async function updatePersona(db: Db, ctx: OrgContext, personaId: string, input: z.input<typeof updateInput>) {
  requireOwner(ctx);
  const data = updateInput.safeParse(input);
  if (!data.success || !dnaComplete(data.data.dna as PersonaDna)) throw new PersonaError("INVALID");
  const p = await personaById(db, ctx, personaId);
  await brandFor(db, ctx, p.brandId, true);
  await forOrg(db, ctx).update(personas, { name: data.data.name, handle: data.data.handle.replace(/^@/, ""), dna: data.data.dna as PersonaDna, updatedAt: new Date() }, eq(personas.id, personaId));
}

/** Owner deletes the persona and its passport (rows first; the pictures afterwards, best effort). */
export async function deletePersona(db: Db, storage: Storage, ctx: OrgContext, personaId: string) {
  requireOwner(ctx);
  const p = await personaById(db, ctx, personaId);
  const imgs = await passportImages(db, ctx, p.id);
  await forOrg(db, ctx).delete(personas, eq(personas.id, p.id));
  await Promise.all(imgs.map((i) => storage.delete(i.storageKey).catch(() => undefined)));
}

type NewImage = { angle: PassportAngle; source: "uploaded" | "generated"; bytes: Uint8Array; contentType: string; width: number; height: number; filename?: string | null; model?: string | null; prompt?: string | null };

/** Stores one passport picture; the first one becomes primary. Refuses an 11th picture and exact duplicates. */
async function addImage(db: Db, storage: Storage, ctx: OrgContext, p: PersonaRow, img: NewImage): Promise<string> {
  const sha256 = createHash("sha256").update(img.bytes).digest("hex");
  const existing = await passportImages(db, ctx, p.id);
  if (existing.length >= MAX_PASSPORT) throw new PersonaError("LIMIT_REACHED");
  if (existing.some((e) => e.sha256 === sha256)) throw new PersonaError("DUPLICATE");
  const k = storageKey(ctx.orgId, p.brandId, "persona", img.contentType === "image/png" ? "png" : "jpg");
  await storage.put(k, img.bytes, img.contentType);
  const id = crypto.randomUUID();
  try {
    await forOrg(db, ctx).insert(personaImages, {
      id, personaId: p.id, angle: img.angle, isPrimary: existing.length === 0, source: img.source, storageKey: k, contentType: img.contentType,
      width: img.width, height: img.height, sizeBytes: img.bytes.byteLength, sha256, filename: img.filename ?? null, model: img.model ?? null, prompt: img.prompt ?? null, createdBy: ctx.userId,
    });
  } catch (e) {
    await storage.delete(k).catch(() => undefined);
    const err = e as { code?: string; cause?: { code?: string } };
    if (err?.code === "23505" || err?.cause?.code === "23505") throw new PersonaError("DUPLICATE");
    throw e;
  }
  return id;
}

const angleInput = z.enum([...PASSPORT_ANGLES, "other"]);

/** Owner uploads a picture of the person (re-encoded: metadata dropped, ≤ 4096 px). */
export async function uploadPassportImage(db: Db, storage: Storage, ctx: OrgContext, personaId: string, file: { filename: string; bytes: Uint8Array }, angle: string = "other") {
  requireOwner(ctx);
  const a = angleInput.safeParse(angle);
  if (!a.success) throw new PersonaError("INVALID");
  const p = await personaById(db, ctx, personaId);
  await brandFor(db, ctx, p.brandId, true);
  if (file.bytes.byteLength > MAX_PASSPORT_BYTES) throw new PersonaError("TOO_LARGE");
  if (!["png", "jpeg", "webp"].includes(sniff(file.bytes))) throw new PersonaError("INVALID_FILE");
  let img;
  try {
    img = await reencodeImage(file.bytes, "image");
  } catch {
    throw new PersonaError("INVALID_FILE");
  }
  if (img.width < 256 || img.height < 256) throw new PersonaError("INVALID_FILE");
  return addImage(db, storage, ctx, p, { angle: a.data, source: "uploaded", bytes: img.bytes, contentType: img.contentType, width: img.width, height: img.height, filename: cleanFilename(file.filename) });
}

async function imageOf(db: Db, ctx: OrgContext, imageId: string) {
  const [i] = (await forOrg(db, ctx).select(personaImages, eq(personaImages.id, imageId))) as ImageRow[];
  if (!i) throw new PersonaError("NOT_FOUND");
  return i;
}

/** Owner marks the picture every generation starts from. */
export async function setPrimaryImage(db: Db, ctx: OrgContext, imageId: string) {
  requireOwner(ctx);
  const i = await imageOf(db, ctx, imageId);
  await db.transaction(async (tx) => {
    const s = forOrg(tx as unknown as Db, ctx);
    await s.update(personaImages, { isPrimary: false }, and(eq(personaImages.personaId, i.personaId), ne(personaImages.id, i.id)));
    await s.update(personaImages, { isPrimary: true }, eq(personaImages.id, i.id));
  });
}

/** Owner removes a picture; when it was the primary, the oldest remaining one takes its place. */
export async function deletePassportImage(db: Db, storage: Storage, ctx: OrgContext, imageId: string) {
  requireOwner(ctx);
  const i = await imageOf(db, ctx, imageId);
  await db.transaction(async (tx) => {
    const s = forOrg(tx as unknown as Db, ctx);
    await s.delete(personaImages, eq(personaImages.id, i.id));
    if (i.isPrimary) {
      const [next] = await tx.select({ id: personaImages.id }).from(personaImages)
        .where(and(eq(personaImages.orgId, ctx.orgId), eq(personaImages.personaId, i.personaId))).orderBy(asc(personaImages.createdAt)).limit(1);
      if (next) await s.update(personaImages, { isPrimary: true }, eq(personaImages.id, next.id));
    }
  });
  await storage.delete(i.storageKey).catch(() => undefined);
}

/** A presigned URL for one passport picture (members of the org). */
export async function passportImageUrl(db: Db, storage: Storage, ctx: OrgContext, imageId: string, download: boolean) {
  const [r] = await db.select({ key: personaImages.storageKey, type: personaImages.contentType, angle: personaImages.angle, name: personas.name })
    .from(personaImages)
    .innerJoin(personas, and(eq(personas.id, personaImages.personaId), eq(personas.orgId, ctx.orgId)))
    .where(and(eq(personaImages.id, imageId), eq(personaImages.orgId, ctx.orgId)));
  if (!r) throw new PersonaError("NOT_FOUND");
  const slug = r.name.normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "persona";
  return storage.presignGet(r.key, { filename: `${slug}-${r.angle}.${r.type === "image/png" ? "png" : "jpg"}`, contentType: r.type, inline: !download });
}

// ---- Passport generation ----------------------------------------------------------------------------------------

/**
 * How each angle is asked for, and its shape. The first ("front") is the passport photo itself: the whole DNA,
 * framed as a passport-style portrait; the others keep the person from the references and change only the view.
 */
const ANGLE: Record<(typeof PASSPORT_ANGLES)[number], { pose: string; width: number; height: number }> = {
  front: { pose: "Passport-style portrait: head and shoulders, centred, facing the camera straight on at eye level, eyes to the camera", width: 1024, height: 1280 },
  three_quarter: { pose: "Head-and-shoulders portrait, head turned three-quarters to the left, eyes to the camera", width: 1024, height: 1280 },
  profile: { pose: "Head-and-shoulders portrait in side profile, facing left", width: 1024, height: 1280 },
  smile: { pose: "Head-and-shoulders portrait facing the camera with a natural, warm smile", width: 1024, height: 1280 },
  full_body: { pose: "Full-body photo, whole figure from head to shoes, front view", width: 832, height: 1248 },
};

/** Angles of the standard set still missing. With any picture present, a front portrait is not needed to start from. */
export function missingAngles(images: Pick<ImageRow, "angle">[]): (typeof PASSPORT_ANGLES)[number][] {
  const have = new Set(images.map((i) => i.angle));
  const room = MAX_PASSPORT - images.length;
  return PASSPORT_ANGLES.filter((a) => !have.has(a) && !(a === "front" && images.length > 0)).slice(0, Math.max(0, room));
}

/**
 * The prompt for one passport picture. The DNA goes in whole (owner: "prompt, ki vključuje tvoj DNA"); the framing
 * of the angle overrides the DNA's own camera angle and pose, so the set shows the same person from every side.
 */
export function passportPrompt(dna: PersonaDna, angle: (typeof PASSPORT_ANGLES)[number], withReferences: boolean): string {
  const scene = DNA_FIELDS.filter((f) => f !== "camera" && f !== "pose");
  return [
    withReferences
      ? "The SAME person as in the reference images: keep exactly the same face, features, skin, eyes, hair and age."
      : "An original, fictional adult person, described by this DNA:",
    dnaBlock(dna, scene),
    `Framing: ${ANGLE[angle].pose}. Keep the DNA's clothing, mood, lighting and style; the setting softly out of focus behind.`,
    "No text, no letters, no watermark, no logo.",
  ].join("\n");
}

async function defaultModel(db: Db, kind: "image" | "image_ref") {
  return (await db.select().from(modelRegistry).where(and(eq(modelRegistry.kind, kind), eq(modelRegistry.isDefault, true), eq(modelRegistry.enabled, true))))[0];
}

const priceOf = (m: typeof modelRegistry.$inferSelect, width: number, height: number) => {
  const g = generationSize(width, height);
  return m.perImage + BigInt(billedMegapixels(g.width, g.height)) * m.perMegapixel;
};

/** At most what filling the passport costs now: the missing angles, the first one from text when there is no picture. */
export async function passportEstimate(db: Db, ctx: OrgContext, personaId: string): Promise<{ count: number; maxCost: bigint | null }> {
  const imgs = await passportImages(db, ctx, personaId);
  const todo = missingAngles(imgs);
  if (!todo.length) return { count: 0, maxCost: 0n };
  const [plain, ref] = await Promise.all([defaultModel(db, "image"), defaultModel(db, "image_ref")]);
  if (!ref || (!imgs.length && !plain)) return { count: todo.length, maxCost: null };
  let cost = 0n;
  todo.forEach((a, n) => { cost += !imgs.length && n === 0 ? priceOf(plain!, ANGLE[a].width, ANGLE[a].height) : priceOf(ref, ANGLE[a].width, ANGLE[a].height); });
  return { count: todo.length, maxCost: cost };
}

/** Owner: queue the generation of the missing passport pictures (one run at a time). */
export async function requestPassport(db: Db, queue: Queue, ctx: OrgContext, personaId: string) {
  requireOwner(ctx);
  const p = await personaById(db, ctx, personaId);
  await brandFor(db, ctx, p.brandId, true);
  if (!missingAngles(await passportImages(db, ctx, p.id)).length) throw new PersonaError("NOTHING_TO_DO");
  if (!(await defaultModel(db, "image_ref"))) throw new PersonaError("NO_REF_MODEL");
  const claimed = await forOrg(db, ctx).update(
    personas,
    { passportStatus: "queued", passportError: null, passportRequestedBy: ctx.userId, updatedAt: new Date() },
    and(eq(personas.id, p.id), or(inArray(personas.passportStatus, ["none", "ready", "failed"]), and(inArray(personas.passportStatus, ["queued", "rendering"]), lt(personas.updatedAt, new Date(Date.now() - STALE_MS))))!)!,
  );
  if (!claimed.length) throw new PersonaError("BAD_STATE");
  await queue.send(PERSONA_PASSPORT_QUEUE, { personaId: p.id } satisfies PassportJob, `persona:${p.id}:passport`);
}

/**
 * The persona's pictures as references for a reference model: the primary first, then up to `max - 1` others, each
 * scaled to ≤ 1024 px JPEG data URIs (small requests, no presigned links leaving the org).
 */
export async function passportReferences(db: Db, storage: Storage, ctx: OrgContext, personaId: string, max = 4): Promise<string[]> {
  const imgs = (await passportImages(db, ctx, personaId)).slice(0, max);
  const out: string[] = [];
  for (const i of imgs) {
    const small = await sharp(await storage.get(i.storageKey), { limitInputPixels: MAX_INPUT_PIXELS }).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    out.push(`data:image/jpeg;base64,${small.toString("base64")}`);
  }
  return out;
}

/**
 * One picture of the persona with the default reference model (or, with no references, the default text-to-image
 * model): cost reserved first, released on provider errors, settled on delivery. Used by the passport and, later, by
 * persona keyframes.
 */
export async function personaPicture(db: Db, deps: Pick<ImageDeps, "images" | "now">, ctx: OrgContext, who: { brandId: string; postId: string | null }, prompt: string, shape: { width: number; height: number }, references: string[]) {
  if (!deps.images) throw new ImageError("NO_IMAGE_KEY");
  const model = await defaultModel(db, references.length ? "image_ref" : "image");
  if (!model) throw new PersonaError("NO_REF_MODEL");
  const gen = generationSize(shape.width, shape.height);
  const ledgerId = await reserve(db, { orgId: ctx.orgId, brandId: who.brandId, postId: who.postId, provider: model.provider, model: model.modelKey, estimate: priceOf(model, shape.width, shape.height), now: deps.now });
  let out;
  try {
    out = await deps.images.generate({ model: model.modelKey, prompt, ...gen, references: references.length ? references : undefined, negativePrompt: "text, letters, watermark, logo, deformed, extra fingers" });
  } catch (e) {
    await release(db, ledgerId);
    throw e;
  }
  const billed = billedMegapixels(out.width, out.height);
  await db.update(usageLedger).set({ state: "settled", megapixels: billed, costMicroUsd: model.perImage + BigInt(billed) * model.perMegapixel }).where(eq(usageLedger.id, ledgerId));
  return { ...out, model: model.modelKey };
}

/** Makes the missing passport pictures one by one; each is kept as soon as it is made. */
export async function generatePassport(db: Db, deps: ImageDeps, ctx: OrgContext, personaId: string): Promise<number> {
  const p = await personaById(db, ctx, personaId);
  const todo = missingAngles(await passportImages(db, ctx, p.id));
  let made = 0;
  for (const angle of todo) {
    // References are re-read each time, so the second picture already sees the first.
    const refs = await passportReferences(db, deps.storage, ctx, p.id);
    const prompt = passportPrompt(p.dna, angle, refs.length > 0);
    const out = await personaPicture(db, deps, ctx, { brandId: p.brandId, postId: null }, prompt, ANGLE[angle], refs);
    try {
      await addImage(db, deps.storage, ctx, p, { angle, source: "generated", bytes: out.bytes, contentType: out.contentType, width: out.width, height: out.height, model: out.model, prompt });
      made++;
    } catch (e) {
      // The model gave back a picture the passport already has: nothing new to keep, go on with the next angle.
      if (!(e instanceof PersonaError && e.code === "DUPLICATE")) throw e;
    }
  }
  return made;
}

export function passportFailureCode(e: unknown): string | null {
  if (e instanceof ImageError) return e.code;
  if (e instanceof SpendCapError) return "SPEND_CAP";
  if (e instanceof PersonaError) return e.code;
  if (e instanceof LlmError) return e.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "LLM_PROVIDER";
  return null;
}

/** Worker side: acts as the owner who asked (re-verified, still an owner); expected failures are recorded. */
export async function runPassportJob(db: Db, deps: ImageDeps, job: PassportJob): Promise<"done" | "skipped" | "failed"> {
  const [p] = await db.select({ id: personas.id, orgId: personas.orgId, by: personas.passportRequestedBy }).from(personas).where(eq(personas.id, job.personaId));
  if (!p) return "skipped";
  const claimed = await db.update(personas).set({ passportStatus: "rendering", updatedAt: new Date() }).where(and(eq(personas.id, p.id), eq(personas.passportStatus, "queued"))).returning({ id: personas.id });
  if (!claimed.length) return "skipped";
  const fail = async (code: string) => {
    await db.update(personas).set({ passportStatus: "failed", passportError: code.slice(0, 300), updatedAt: new Date() }).where(eq(personas.id, p.id));
    return "failed" as const;
  };
  if (!p.by) return fail("NO_ACCESS");
  let ctx: OrgContext;
  try {
    ctx = await resolveOrgContext(db, { userId: p.by, activeOrganizationId: p.orgId });
  } catch (e) {
    if (e instanceof TenancyError) return fail("NO_ACCESS");
    throw e;
  }
  if (ctx.role !== "owner") return fail("NO_ACCESS");
  try {
    await generatePassport(db, deps, ctx, p.id);
    await db.update(personas).set({ passportStatus: "ready", passportError: null, updatedAt: new Date() }).where(eq(personas.id, p.id));
    return "done";
  } catch (e) {
    const code = passportFailureCode(e);
    if (code) return fail(code);
    await db.update(personas).set({ passportStatus: "queued" }).where(and(eq(personas.id, p.id), eq(personas.passportStatus, "rendering")));
    throw e;
  }
}

/** The Claude call that structures the DNA, at most (for the button). */
export async function dnaEstimate(db: Db, brandId: string): Promise<bigint | null> {
  const model = await textModelFor(db, brandId).catch(() => null);
  return model ? worstCaseMicroUsd(DNA_TEXT_MAX + 9_000, 3_000, model) : null;
}

export { personaDnaSchema };
