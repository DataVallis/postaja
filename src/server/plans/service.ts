// Plan import (TASK-012, ADR-041): upload → read (AI names the columns or lists the posts) → owner reviews the start
// date and which channel each platform/account goes to → posts are created (texts verbatim, rule-checked; published
// rows become history). Every query is scoped to the caller's org; channels are re-checked against the org on save.
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { brands, channels, modelRegistry, planImports, posts, postMedia, type ImportSettings, type PostContent, type PostPlan } from "../db/schema";
import { BrandError, addChannel, createBrandNamed } from "../brands/service";
import { LANGUAGES } from "../brands/schemas";
import { ExtractError, materialText } from "../files/extract";
import { sniff } from "../files/sniff";
import type { Storage } from "../files/storage";
import { costMicroUsd, worstCaseMicroUsd } from "../llm/cost";
import { release, reserve, settle, SpendCapError } from "../llm/spend";
import { LlmError, type LlmClient, type StructuredRequest } from "../llm/types";
import { checkPost, rulesFor } from "../posts/generate";
import { resolveOrgContext, TenancyError, type OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { DOC_MAX_CHARS, EXTRACT_MAX_TOKENS, extractRequest, MAPPING_MAX_TOKENS, mappingRequest, readExtraction, readMapping } from "./ai";
import { extractHashtags, guessMapping, mapRows, mappingSchema, platformFromName, type ColumnMapping, type PlanItem } from "./mapping";
import { tablesFromCsv, tablesFromXlsx, type PlanTable } from "./table";

export const IMPORT_MAX_BYTES = 20 * 1024 * 1024;
const MAX_SHEETS = 10;

export class ImportError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "EMPTY" | "TOO_LARGE" | "UNSUPPORTED_TYPE" | "INVALID_FILE" | "NO_POSTS" | "BAD_STATE" | "INVALID" | "AI_FAILED" | "SPEND_CAP" | "NO_MODEL" | "PLATFORM_MISMATCH" | "FORBIDDEN" | "BRAND_LIMIT", public readonly detail?: string) {
    super(code);
  }
}

type Deps = { llm: LlmClient; storage: Storage };
type ImportRow = typeof planImports.$inferSelect;

/** One provider call under the org's spend cap (ADR-036). Returns null when the provider fails (caller decides). */
async function callAi(db: Db, ctx: OrgContext, llm: LlmClient, req: Omit<StructuredRequest, "model" | "maxTokens">, maxTokens: number) {
  const [model] = await db.select().from(modelRegistry).where(and(eq(modelRegistry.kind, "text"), eq(modelRegistry.isDefault, true), eq(modelRegistry.enabled, true)));
  if (!model) throw new ImportError("NO_MODEL");
  const chars = req.system.reduce((n, b) => n + b.text.length, 0) + req.user.length + JSON.stringify(req.tool).length;
  let ledger: string;
  try {
    ledger = await reserve(db, { orgId: ctx.orgId, brandId: null, postId: null, provider: model.provider, model: model.modelKey, estimate: worstCaseMicroUsd(chars, maxTokens, model) });
  } catch (e) {
    if (e instanceof SpendCapError) throw new ImportError("SPEND_CAP");
    throw e;
  }
  try {
    const out = await llm.structured({ ...req, model: model.modelKey, maxTokens });
    await settle(db, ledger, out.usage, costMicroUsd(out.usage, model));
    return { input: out.input, model: model.modelKey };
  } catch (e) {
    await release(db, ledger);
    if (e instanceof LlmError) return { error: e.code, model: model.modelKey };
    throw e;
  }
}

export const PLAN_READ_QUEUE = "plan-read";
export type PlanReadJob = { importId: string };
/** A plan still "reading" after this long is shown as failed (the worker died or the provider hung). */
export const READ_STALE_MS = 15 * 60 * 1000;

type Prepared =
  | { kind: "table"; filename: string; tables: PlanTable[] }
  | { kind: "document"; filename: string; text: string };
type ReadResult = Pick<ImportRow, "kind" | "tables" | "mappings" | "items" | "reader">;

/** Checks and parses an upload without the AI (fast; runs in the request). Throws ImportError. */
async function prepare(file: { filename: string; bytes: Uint8Array }): Promise<{ prepared: Prepared; ext: string; isCsv: boolean }> {
  if (!file.bytes.byteLength) throw new ImportError("EMPTY");
  if (file.bytes.byteLength > IMPORT_MAX_BYTES) throw new ImportError("TOO_LARGE");
  const filename = (file.filename.split(/[\\/]/).pop() ?? "plan").normalize("NFC").replace(/[\u0000-\u001f]/g, "").slice(0, 200) || "plan";
  const type = sniff(file.bytes);
  const isCsv = type === "text" && /\.(csv|tsv)$/i.test(filename);
  const ext = type === "text" ? (isCsv ? "csv" : "txt") : type;
  if (type === "xlsx" || isCsv) {
    let tables: PlanTable[];
    try {
      tables = type === "xlsx" ? tablesFromXlsx(file.bytes) : tablesFromCsv(new TextDecoder().decode(file.bytes));
    } catch {
      throw new ImportError("INVALID_FILE");
    }
    tables = tables.slice(0, MAX_SHEETS);
    if (!tables.length) throw new ImportError("NO_POSTS");
    return { prepared: { kind: "table", filename, tables }, ext, isCsv };
  }
  if (type === "docx" || type === "pdf" || type === "text") {
    let text: string;
    try {
      text = await materialText(file.bytes, type);
    } catch (e) {
      throw new ImportError(e instanceof ExtractError && e.code === "NO_TEXT" ? "NO_POSTS" : "INVALID_FILE");
    }
    return { prepared: { kind: "document", filename, text }, ext, isCsv };
  }
  throw new ImportError("UNSUPPORTED_TYPE", type);
}

/** Up to this many characters go to Claude in one call; a longer plan is read in parts at the same time. */
export const DOC_CHUNK_CHARS = 12_000;
const DOC_PARALLEL = 3;

/**
 * Splits a plan document into parts of at most `max` characters, at headings or blank lines, so no post is cut in two
 * (a single paragraph longer than `max` is its own part). Parts keep document order.
 */
export function splitDocument(text: string, max = DOC_CHUNK_CHARS): string[] {
  const t = text.slice(0, DOC_MAX_CHARS);
  if (t.length <= max) return [t];
  // A heading stays with what follows it; a section longer than a part is split further at blank lines.
  const blocks = t.split(/\n(?=#{1,4}\s)/).flatMap((sec) => (sec.length <= max ? [sec] : sec.split(/\n\s*\n/)));
  const parts: string[] = [];
  let cur = "";
  for (const b of blocks) {
    if (cur && cur.length + b.length + 2 > max) { parts.push(cur); cur = ""; }
    cur = cur ? `${cur}\n\n${b}` : b;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** The AI part of reading (mapping columns, or listing the posts of a document). Throws ImportError. */
async function readPrepared(db: Db, deps: Deps, ctx: OrgContext, p: Prepared): Promise<ReadResult> {
  if (p.kind === "table") {
    const mappings: ColumnMapping[] = [];
    let reader: ImportRow["reader"] = { by: "headers" };
    for (const t of p.tables) {
      const guess = guessMapping(t.header, t.rows.slice(0, 8).map((r) => r.cells));
      // No platform column: the file or sheet name may say it ("CHERR.IO_X_posts.xlsx").
      if (!guess.columns.includes("platform")) guess.defaultPlatform = platformFromName(`${p.filename} ${t.sheet}`);
      const ai = await callAi(db, ctx, deps.llm, mappingRequest(t, p.filename, guess), MAPPING_MAX_TOKENS);
      const read = "input" in ai ? readMapping(ai.input, t.header.length) : null;
      if (read) reader = { by: "ai", model: ai.model };
      else if ("error" in ai) reader = { ...reader, error: ai.error };
      const chosen = read ?? guess;
      if (!chosen.columns.includes("platform") && !chosen.defaultPlatform) chosen.defaultPlatform = platformFromName(`${p.filename} ${t.sheet}`);
      mappings.push(chosen);
    }
    return { kind: "table", tables: p.tables, mappings, items: null, reader };
  }
  // A long plan is read in parts at the same time (faster, and no part hits the answer's token limit); the answers are
  // joined in document order, with the first shared image style / platform any part found.
  const parts = splitDocument(p.text);
  const answers: { input: unknown; model: string }[] = new Array(parts.length);
  let next = 0;
  let failure: ImportError | null = null;
  const work = async () => {
    while (next < parts.length && !failure) {
      const i = next++;
      const label = parts.length > 1 ? `${p.filename} (part ${i + 1} of ${parts.length})` : p.filename;
      try {
        const ai = await callAi(db, ctx, deps.llm, extractRequest(parts[i], label), EXTRACT_MAX_TOKENS);
        if ("error" in ai) failure = new ImportError("AI_FAILED", ai.error);
        else answers[i] = ai;
      } catch (e) {
        if (e instanceof ImportError) failure = e;
        else throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DOC_PARALLEL, parts.length) }, work));
  if (failure) throw failure;
  const ok = answers.map((a) => a.input as { items?: unknown[]; sharedImageStyle?: unknown; defaultPlatform?: unknown } | null);
  if (ok.some((a) => !a || !Array.isArray(a.items))) throw new ImportError("AI_FAILED", "INVALID_OUTPUT");
  const merged = {
    sharedImageStyle: ok.find((a) => a!.sharedImageStyle)?.sharedImageStyle ?? null,
    defaultPlatform: ok.find((a) => a!.defaultPlatform)?.defaultPlatform ?? null,
    items: ok.flatMap((a) => a!.items!),
  };
  const items = readExtraction(merged, p.text);
  if (!items) throw new ImportError("AI_FAILED", "INVALID_OUTPUT");
  if (!items.length) throw new ImportError("NO_POSTS");
  return { kind: "document", tables: null, mappings: [], items, reader: { by: "ai", model: answers[0].model } };
}

/**
 * Stores an uploaded plan. With a queue (the web request) the file is checked and stored at once and the AI reads it in
 * the background (status "reading" → "draft" or "failed"): a long Word/Markdown plan takes minutes, longer than any
 * proxy waits (incident 2026-10-11). Without a queue (tests, scripts) it is read inline and AI errors throw.
 */
export async function startImport(db: Db, deps: Deps & { queue?: ReadQueue }, ctx: OrgContext, file: { filename: string; bytes: Uint8Array }): Promise<string> {
  const { prepared, ext, isCsv } = await prepare(file);
  const id = crypto.randomUUID();
  const key = `org/${ctx.orgId}/imports/${id}.${ext}`;
  const base = { id, filename: prepared.filename, storageKey: key, sha256: createHash("sha256").update(file.bytes).digest("hex"), createdBy: ctx.userId };
  if (!deps.queue) {
    const row = await readPrepared(db, deps, ctx, prepared);
    await deps.storage.put(key, file.bytes, isCsv ? "text/csv; charset=utf-8" : "application/octet-stream");
    await forOrg(db, ctx).insert(planImports, { ...base, ...row });
    return id;
  }
  await deps.storage.put(key, file.bytes, isCsv ? "text/csv; charset=utf-8" : "application/octet-stream");
  await forOrg(db, ctx).insert(planImports, {
    ...base, kind: prepared.kind, status: "reading", tables: prepared.kind === "table" ? prepared.tables : null, mappings: [], items: null, reader: { by: "ai" },
  });
  await deps.queue.send(PLAN_READ_QUEUE, { importId: id } satisfies PlanReadJob, `plan-read:${id}`);
  return id;
}

export type ReadQueue = { send(name: string, data: object, key: string): Promise<void> };

/** Worker: reads a stored plan with the AI. Never throws for expected outcomes; a failure is kept on the import. */
export async function runReadJob(db: Db, deps: Deps, job: PlanReadJob): Promise<"draft" | "failed" | "skipped"> {
  const [r] = await db.select().from(planImports).where(eq(planImports.id, job.importId));
  if (!r || r.status !== "reading") return "skipped";
  const fail = async (error: string) => {
    await db.update(planImports).set({ status: "failed", error: error.slice(0, 200) }).where(and(eq(planImports.id, r.id), eq(planImports.status, "reading")));
    return "failed" as const;
  };
  let ctx: OrgContext;
  try {
    ctx = await resolveOrgContext(db, { userId: r.createdBy, activeOrganizationId: r.orgId });
  } catch (e) {
    if (e instanceof TenancyError) return fail("FORBIDDEN");
    throw e;
  }
  try {
    let prepared: Prepared;
    if (r.kind === "table") prepared = { kind: "table", filename: r.filename, tables: (r.tables ?? []) as PlanTable[] };
    else {
      const bytes = await deps.storage.get(r.storageKey);
      prepared = (await prepare({ filename: r.filename, bytes })).prepared;
    }
    const row = await readPrepared(db, deps, ctx, prepared);
    await db.update(planImports).set({ ...row, status: "draft", error: null }).where(and(eq(planImports.id, r.id), eq(planImports.status, "reading")));
    return "draft";
  } catch (e) {
    if (e instanceof ImportError) return fail(e.detail ? `${e.code}:${e.detail}` : e.code);
    await fail("FAILED");
    throw e;
  }
}

async function ownImport(db: Db, ctx: OrgContext, id: string): Promise<ImportRow> {
  const [r] = (await forOrg(db, ctx).select(planImports, eq(planImports.id, id))) as ImportRow[];
  if (!r) throw new ImportError("NOT_FOUND");
  return r;
}

export function importItems(r: Pick<ImportRow, "kind" | "tables" | "mappings" | "items">): PlanItem[] {
  if (r.kind === "document") return (r.items ?? []) as PlanItem[];
  const tables = (r.tables ?? []) as PlanTable[];
  return tables.flatMap((t, i) => mapRows(t, (r.mappings[i] as ColumnMapping) ?? guessMapping(t.header)));
}

export const groupKey = (i: Pick<PlanItem, "platform" | "account">) => `${i.platform ?? ""}|${i.account ?? ""}`;
const handle = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]/g, "");

type OrgChannel = { id: string; platform: string; handle: string; brandId: string; brandName: string };
type OrgBrand = { id: string; name: string; slug: string };

/** The brand a plan file names (file or sheet name contains its name or slug), when exactly one does. */
export function brandFromName(text: string, list: OrgBrand[]): OrgBrand | null {
  const t = handle(text);
  const hits = list.filter((b) => [b.name, b.slug].some((n) => { const h = handle(n); return h.length > 2 && t.includes(h); }));
  // "aibuilders" and "ai" style overlaps: the longest name wins only if it contains every other hit.
  if (hits.length > 1) {
    const best = [...hits].sort((a, b) => handle(b.name).length - handle(a.name).length)[0];
    return hits.every((h) => handle(best.name).includes(handle(h.name)) || handle(best.slug).includes(handle(h.slug))) ? best : null;
  }
  return hits[0] ?? null;
}

/**
 * The channel to suggest for a platform + account of a plan. Never a guess across brands:
 * - the account matches one channel's handle (either contains the other) or a word of its brand's name → that channel;
 * - the file names a brand → only that brand's channel of the platform (none → no suggestion, the owner adds it);
 * - otherwise nothing: a plan for a brand that is not in Postaja yet must not land on another brand's channel
 *   (owner, 2026-10-07: a CHERR.IO plan was offered AI Builders' X channel). The owner picks or creates the brand.
 */
export function suggestChannel(platform: string | null, account: string | null, list: OrgChannel[], hint: { brand: OrgBrand | null; brandCount: number } = { brand: null, brandCount: 1 }): string | null {
  if (!platform) return null;
  const same = list.filter((c) => c.platform === platform);
  if (account) {
    const a = handle(account);
    const hit = same.filter((c) => { const h = handle(c.handle); return h.length > 2 && a.length > 2 && (a.includes(h) || h.includes(a)); });
    if (hit.length === 1) return hit[0].id;
    // "David (osebni profil)" → the brand "David Tacer": a word of the account (≥ 4 letters) is a word of the brand name.
    const words = (x: string) => new Set(x.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
    const aw = words(account);
    const byName = same.filter((c) => [...words(c.brandName)].some((w) => aw.has(w)));
    if (byName.length === 1) return byName[0].id;
  }
  if (hint.brand) {
    const own = same.filter((c) => c.brandId === hint.brand!.id);
    return own.length === 1 ? own[0].id : null;
  }
  return null;
}

const NAME_NOISE = new Set([
  "instagram", "ig", "x", "twitter", "linkedin", "li", "facebook", "fb", "tiktok", "youtube", "yt", "posts", "post", "objave", "objav",
  "objava", "plan", "plans", "content", "vsebin", "vsebine", "dni", "dan", "days", "day", "calendar", "koledar", "copy", "kopija",
  "final", "draft", "v", "of", "za", "the", "in", "and", "on", "teden", "week", "weeks", "mesec", "month",
]);

/** A brand name from a plan's file name, for a brand that does not exist yet: "CHERR.IO X posts 001 (1).xlsx" → "CHERR.IO". */
export function brandNameFromFile(filename: string): string | null {
  const base = filename.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/\([^)]*\)/g, " ");
  const words = base.split(/[\s_—–]+|\s-\s/).map((w) => w.replace(/^[-.,;:]+|[-.,;:]+$/g, "")).filter((w) => /\p{L}/u.test(w) && !NAME_NOISE.has(w.toLowerCase()) && !/^\d/.test(w));
  const name = words.join(" ").trim().slice(0, 80);
  return name.length >= 2 ? name : null;
}

const addDays = (isoDate: string, n: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The day an item lands on: its own date, start + offset, or (undated) start + k × interval; else unscheduled. */
export function scheduleOf(items: PlanItem[], s: ImportSettings): (string | null)[] {
  let k = 0;
  return items.map((i) => {
    if (i.date) return i.date;
    if (i.dayOffset !== null) return s.startDate ? addDays(s.startDate, i.dayOffset) : null;
    if (s.startDate && s.intervalDays) return addDays(s.startDate, k++ * s.intervalDays);
    return null;
  });
}

async function orgChannels(db: Db, ctx: OrgContext): Promise<OrgChannel[]> {
  return db
    .select({ id: channels.id, platform: channels.platform, handle: channels.handle, brandId: channels.brandId, brandName: brands.name })
    .from(channels)
    .innerJoin(brands, and(eq(brands.id, channels.brandId), eq(brands.orgId, ctx.orgId), sql`${brands.archivedAt} is null`))
    .where(eq(channels.orgId, ctx.orgId))
    .orderBy(brands.name, channels.platform);
}

/** Everything the review screen shows. */
export async function importView(db: Db, ctx: OrgContext, id: string) {
  const r = await ownImport(db, ctx, id);
  const items = importItems(r);
  const list = await orgChannels(db, ctx);
  const brandList = await db.select({ id: brands.id, name: brands.name, slug: brands.slug }).from(brands).where(and(eq(brands.orgId, ctx.orgId), sql`${brands.archivedAt} is null`)).orderBy(brands.name);
  const chosen = r.settings.brandId ? brandList.find((b) => b.id === r.settings.brandId) ?? null : null;
  const hint = { brand: chosen ?? brandFromName(r.filename, brandList), brandCount: brandList.length };
  // A chosen brand limits suggestions to its own channels, account matches included.
  const pool = chosen ? list.filter((c) => c.brandId === chosen.id) : list;
  const map = r.settings.channelMap ?? {};
  const groups = new Map<string, { key: string; platform: string | null; account: string | null; count: number; channelId: string | null; suggested: string | null }>();
  for (const i of items) {
    const key = groupKey(i);
    const g = groups.get(key) ?? { key, platform: i.platform, account: i.account, count: 0, channelId: null, suggested: suggestChannel(i.platform, i.account, pool, hint) };
    g.count++;
    groups.set(key, g);
  }
  // A saved choice of a channel on another platform (allowed before) is ignored: LinkedIn rows never go to Instagram.
  const platformOf = new Map(list.map((c) => [c.id, c.platform]));
  for (const g of groups.values()) {
    const chosen = map[g.key];
    const ok = chosen === "skip" || (chosen && (!g.platform || platformOf.get(chosen) === g.platform));
    g.channelId = ok ? chosen! : g.suggested;
  }
  return {
    import: r, stale: isStale(r), items, schedule: scheduleOf(items, r.settings), groups: [...groups.values()], channels: list, brand: hint.brand,
    brandChosen: !!chosen, brands: brandList, newBrandName: hint.brand ? null : brandNameFromFile(r.filename),
  };
}

const brandChoiceInput = z.object({
  brandId: z.string().max(100).optional(),
  newName: z.string().trim().min(2).max(80).optional(),
  language: z.enum(LANGUAGES).optional(),
  /** "platform|account" → handle for a channel the brand does not have yet (empty = do not create). */
  handles: z.record(z.string().max(500), z.string().trim().max(80)).default({}),
});

/**
 * The owner says which brand the plan is for (owner, 2026-10-07): an existing brand, or a new one created here with the
 * plan's channels (handle per platform from the form, default the plan's account). Choosing resets earlier channel
 * choices; suggestions then come only from this brand's channels.
 */
export async function setImportBrand(db: Db, ctx: OrgContext, id: string, input: z.input<typeof brandChoiceInput>) {
  const p = brandChoiceInput.parse(input);
  const r = await ownImport(db, ctx, id);
  if (r.status !== "draft") throw new ImportError("BAD_STATE");
  if (!!p.brandId === !!p.newName) throw new ImportError("INVALID");
  try {
    let brandId = p.brandId;
    if (p.newName) {
      const all = (await forOrg(db, ctx).select(brands)) as (typeof brands.$inferSelect)[];
      const same = all.find((b) => !b.archivedAt && b.name.trim().toLowerCase() === p.newName!.toLowerCase());
      brandId = same ? same.id : (await createBrandNamed(db, ctx, { name: p.newName, languages: [p.language ?? "sl"] })).id;
    }
    const [b] = (await forOrg(db, ctx).select(brands, eq(brands.id, brandId!))) as (typeof brands.$inferSelect)[];
    if (!b || b.archivedAt) throw new ImportError("INVALID");
    const own = (await forOrg(db, ctx).select(channels, eq(channels.brandId, b.id))) as (typeof channels.$inferSelect)[];
    const made = new Set(own.map((c) => c.platform as string));
    for (const g of new Map(importItems(r).map((i) => [groupKey(i), i])).values()) {
      const handle = p.handles[groupKey(g)];
      if (!g.platform || made.has(g.platform) || !handle) continue;
      await addChannel(db, ctx, b.id, {
        platform: g.platform, handle, language: b.languages[0] as (typeof LANGUAGES)[number],
        goal: { postsPerDay: 1, weekdays: [1, 2, 3, 4, 5] }, allowedTypes: ["text", "single_image", "carousel"],
      });
      made.add(g.platform);
    }
    await forOrg(db, ctx).update(planImports, { settings: { ...r.settings, brandId: b.id, channelMap: {} } }, eq(planImports.id, id));
    return { brandId: b.id };
  } catch (e) {
    if (e instanceof BrandError) throw new ImportError(e.code === "FORBIDDEN" ? "FORBIDDEN" : e.code === "LIMIT_REACHED" ? "BRAND_LIMIT" : "INVALID", e.code);
    if (e instanceof z.ZodError) throw new ImportError("INVALID");
    throw e;
  }
}

const updateInput = z.object({
  mappings: z.array(mappingSchema).max(MAX_SHEETS).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  intervalDays: z.number().int().min(1).max(60).nullable().optional(),
  channelMap: z.record(z.string().max(500), z.string().max(100)).optional(),
});

export async function updateImport(db: Db, ctx: OrgContext, id: string, patch: z.input<typeof updateInput>) {
  const p = updateInput.parse(patch);
  const r = await ownImport(db, ctx, id);
  if (r.status !== "draft") throw new ImportError("BAD_STATE");
  const set: Partial<typeof planImports.$inferInsert> = {};
  if (p.mappings) {
    const tables = (r.tables ?? []) as PlanTable[];
    if (r.kind !== "table" || p.mappings.length !== tables.length || p.mappings.some((m, i) => m.columns.length !== tables[i].header.length)) throw new ImportError("INVALID");
    set.mappings = p.mappings;
  }
  if (p.channelMap) {
    const list = await orgChannels(db, ctx);
    const platformOf = new Map(list.map((c) => [c.id, c.platform]));
    if (Object.values(p.channelMap).some((v) => v !== "skip" && !platformOf.has(v))) throw new ImportError("INVALID");
    // The group key starts with the platform ("linkedin|David"); its rows only go to a channel of that platform.
    for (const [key, v] of Object.entries(p.channelMap)) {
      const platform = key.split("|")[0];
      if (v !== "skip" && platform && platformOf.get(v) !== platform) throw new ImportError("PLATFORM_MISMATCH");
    }
  }
  const settings: ImportSettings = { ...r.settings };
  if (p.startDate !== undefined) settings.startDate = p.startDate;
  if (p.intervalDays !== undefined) settings.intervalDays = p.intervalDays;
  if (p.channelMap) settings.channelMap = { ...(r.settings.channelMap ?? {}), ...p.channelMap };
  set.settings = settings;
  await forOrg(db, ctx).update(planImports, set, eq(planImports.id, id));
}

/** Caption as it will be posted: the plan's text verbatim, plus hashtags from the plan that are not in it yet. */
export function composeImported(i: PlanItem): PostContent | null {
  if (!i.text) return null;
  const missing = (text: string) => i.hashtags.filter((h) => !new RegExp(`(^|\\s)${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "iu").test(text));
  if (i.parts?.length) {
    const parts = [...i.parts];
    const add = missing(parts.join("\n\n"));
    if (add.length) parts[parts.length - 1] += `\n\n${add.join(" ")}`;
    const caption = parts.join("\n\n");
    return { caption, parts, hashtags: extractHashtags(caption) };
  }
  const add = missing(i.text);
  const caption = add.length ? `${i.text}\n\n${add.join(" ")}` : i.text;
  return { caption, hashtags: extractHashtags(caption) };
}

function planOf(i: PlanItem): PostPlan {
  const p: PostPlan = {
    topic: i.topic ?? undefined, category: i.category ?? undefined, audience: i.audience ?? undefined, account: i.account ?? undefined,
    cta: i.cta ?? undefined, link: i.link ?? undefined, firstComment: i.firstComment ?? undefined, imagePrompt: i.imagePrompt ?? undefined,
    overlayText: i.overlayText ?? undefined, slides: i.slides.length ? i.slides : undefined, slideCount: i.slideCount ?? undefined,
    notes: i.notes ?? undefined, sourceRef: i.ref,
  };
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as PostPlan;
}

/**
 * Creates the posts. Skipped rows, rows whose platform/account is set to "skip" or has no channel, and posts that
 * already exist (same channel and same text, or same channel, day and topic for text-less plans) are not created.
 */
export async function confirmImport(db: Db, ctx: OrgContext, id: string) {
  const view = await importView(db, ctx, id);
  const r = view.import;
  if (r.status !== "draft") throw new ImportError("BAD_STATE");
  const byGroup = new Map(view.groups.map((g) => [g.key, g.channelId]));
  const chans = new Map(view.channels.map((c) => [c.id, c]));
  const rules = new Map<string, Awaited<ReturnType<typeof rulesFor>> | null>();
  const counts = { created: 0, duplicates: 0, skipped: 0, noChannel: 0, published: 0, planned: 0, needsReview: 0, moved: 0 };

  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    // Lock the import row: a double click cannot import twice.
    const [locked] = await t.select({ status: planImports.status }).from(planImports).where(and(eq(planImports.id, id), eq(planImports.orgId, ctx.orgId))).for("update");
    if (locked?.status !== "draft") throw new ImportError("BAD_STATE");
    const channelIds = [...new Set([...byGroup.values()].filter((v): v is string => !!v && v !== "skip" && chans.has(v)))];
    const existing = channelIds.length
      ? await t.select({ channelId: posts.channelId, caption: sql<string | null>`${posts.content}->>'caption'`, day: posts.scheduledOn, topic: sql<string | null>`${posts.plan}->>'topic'`, importId: posts.importId })
          .from(posts).where(and(eq(posts.orgId, ctx.orgId), inArray(posts.channelId, channelIds)))
      : [];
    // Duplicates: same channel and same text, or — for posts that came from a plan — same channel, day and topic. The
    // second rule keeps a planned item that was since written or edited by hand from coming back on a re-import.
    const byText = new Set(existing.filter((e) => e.caption).map((e) => `${e.channelId}|${e.caption}`));
    const byPlan = new Set(existing.filter((e) => e.importId || !e.caption).map((e) => `${e.channelId}|${e.day}|${e.topic}`));
    const thisRun = new Set<string>();
    // Posts this import already made, by plan row: a row that landed on a channel of another platform (possible before
    // the platform check) is moved to its right channel instead of being created twice.
    const mine = new Map(
      (await t.select({ id: posts.id, ref: sql<string | null>`${posts.plan}->>'sourceRef'`, platform: channels.platform, brandId: posts.brandId, status: posts.status })
        .from(posts).innerJoin(channels, eq(channels.id, posts.channelId))
        .where(and(eq(posts.orgId, ctx.orgId), eq(posts.importId, id))))
        .filter((m) => m.ref).map((m) => [m.ref!, m]),
    );

    for (const [idx, item] of view.items.entries()) {
      if (item.status === "skip") { counts.skipped++; continue; }
      const channelId = byGroup.get(groupKey(item));
      if (channelId === "skip") { counts.skipped++; continue; }
      const ch = channelId ? chans.get(channelId) : undefined;
      if (!ch) { counts.noChannel++; continue; }
      if (!rules.has(ch.id)) rules.set(ch.id, await rulesFor(t, ctx, ch.brandId, ch.id).catch(() => null));
      const rc = rules.get(ch.id);
      if (!rc) { counts.noChannel++; continue; }
      const content = composeImported(item);
      const day = view.schedule[idx];
      const prev = mine.get(item.ref);
      if (prev && item.platform && prev.platform !== item.platform && ch.platform === item.platform) {
        const v = content && prev.status !== "published" ? checkPost(content, rc.rules, rc.cta) : [];
        const st = prev.status === "ready" || prev.status === "needs_review" ? (v.length ? "needs_review" : "ready") : prev.status;
        await forOrg(t, ctx).update(posts, {
          channelId: ch.id, brandId: ch.brandId, profileVersionId: rc.profile.id, status: st, ruleFailures: prev.status === "published" ? [] : v,
          // Images were made for the wrong channel (maybe another brand): start over.
          visual: null, mediaStatus: "none", mediaError: null, updatedAt: new Date(),
        }, eq(posts.id, prev.id));
        // Kept as an earlier version (TASK-033): nothing disappears unless a member deletes it.
        await forOrg(t, ctx).update(postMedia, { archivedAt: new Date() }, and(eq(postMedia.postId, prev.id), isNull(postMedia.archivedAt))!);
        mine.delete(item.ref);
        counts.moved++;
        continue;
      }
      const textKey = content ? `${ch.id}|${content.caption}` : null;
      const planKey = `${ch.id}|${day}|${item.topic}`;
      const dup = textKey ? byText.has(textKey) || byPlan.has(planKey) || thisRun.has(`t|${textKey}`) : byPlan.has(planKey) || thisRun.has(`p|${planKey}`);
      if (dup) { counts.duplicates++; continue; }
      thisRun.add(textKey ? `t|${textKey}` : `p|${planKey}`);
      const violations = content ? checkPost(content, rc.rules, rc.cta) : [];
      const status = !content ? "planned" : item.status === "published" ? "published" : violations.length ? "needs_review" : "ready";
      await forOrg(t, ctx).insert(posts, {
        id: crypto.randomUUID(), brandId: ch.brandId, channelId: ch.id, profileVersionId: rc.profile.id,
        brief: (item.topic ?? item.text?.split("\n")[0] ?? item.ref).slice(0, 2000) || item.ref,
        status, format: item.format, content, plan: planOf(item),
        ruleFailures: status === "published" ? [] : violations,
        scheduledOn: day, scheduledTime: item.time, importId: id,
        publishedAt: status === "published" ? new Date(`${item.publishedOn ?? day ?? new Date().toISOString().slice(0, 10)}T12:00:00Z`) : null,
        createdBy: ctx.userId,
      });
      counts.created++;
      if (status === "published") counts.published++;
      else if (status === "planned") counts.planned++;
      else if (status === "needs_review") counts.needsReview++;
    }
    await forOrg(t, ctx).update(planImports, { status: "imported", createdCount: sql`${planImports.createdCount} + ${counts.created}`, importedAt: new Date() }, eq(planImports.id, id));
  });
  return counts;
}

/**
 * An imported plan can be opened again — e.g. after adding the X or LinkedIn channel its rows had no channel for. The
 * owner maps the new channels and imports again; posts that already exist are skipped as duplicates.
 */
export async function reopenImport(db: Db, ctx: OrgContext, id: string) {
  const rows = await forOrg(db, ctx).update(planImports, { status: "draft" }, and(eq(planImports.id, id), eq(planImports.status, "imported"))!);
  if (!rows.length) throw new ImportError("BAD_STATE");
}

export async function discardImport(db: Db, ctx: OrgContext, id: string) {
  const r = await ownImport(db, ctx, id);
  if (r.status !== "draft" && r.status !== "failed") throw new ImportError("BAD_STATE");
  await forOrg(db, ctx).update(planImports, { status: "discarded" }, eq(planImports.id, id));
}

/** A plan still "reading" after READ_STALE_MS counts as failed (the worker died or the provider hung). */
const isStale = (r: { status: string; createdAt: Date }, now = Date.now()) => r.status === "reading" && now - r.createdAt.getTime() > READ_STALE_MS;

export async function listImports(db: Db, ctx: OrgContext, limit = 50) {
  const rows = await db
    .select({ id: planImports.id, filename: planImports.filename, kind: planImports.kind, status: planImports.status, error: planImports.error, createdCount: planImports.createdCount, createdAt: planImports.createdAt, reader: planImports.reader })
    .from(planImports).where(eq(planImports.orgId, ctx.orgId)).orderBy(desc(planImports.createdAt)).limit(limit);
  return rows.map((r) => (isStale(r) ? { ...r, status: "failed" as const, error: "TIMEOUT" } : r));
}
