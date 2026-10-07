// Plan import (TASK-012, ADR-041): upload → read (AI names the columns or lists the posts) → owner reviews the start
// date and which channel each platform/account goes to → posts are created (texts verbatim, rule-checked; published
// rows become history). Every query is scoped to the caller's org; channels are re-checked against the org on save.
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { brands, channels, modelRegistry, planImports, posts, postMedia, type ImportSettings, type PostContent, type PostPlan } from "../db/schema";
import { ExtractError, materialText } from "../files/extract";
import { sniff } from "../files/sniff";
import type { Storage } from "../files/storage";
import { costMicroUsd, worstCaseMicroUsd } from "../llm/cost";
import { release, reserve, settle, SpendCapError } from "../llm/spend";
import { LlmError, type LlmClient, type StructuredRequest } from "../llm/types";
import { checkPost, rulesFor } from "../posts/generate";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { EXTRACT_MAX_TOKENS, extractRequest, MAPPING_MAX_TOKENS, mappingRequest, readExtraction, readMapping } from "./ai";
import { extractHashtags, guessMapping, mapRows, mappingSchema, platformFromName, type ColumnMapping, type PlanItem } from "./mapping";
import { tablesFromCsv, tablesFromXlsx, type PlanTable } from "./table";

export const IMPORT_MAX_BYTES = 20 * 1024 * 1024;
const MAX_SHEETS = 10;

export class ImportError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "EMPTY" | "TOO_LARGE" | "UNSUPPORTED_TYPE" | "INVALID_FILE" | "NO_POSTS" | "BAD_STATE" | "INVALID" | "AI_FAILED" | "SPEND_CAP" | "NO_MODEL" | "PLATFORM_MISMATCH", public readonly detail?: string) {
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

/** Reads an uploaded plan and stores it as a draft import. Tables never fail on the AI (headers are the fallback). */
export async function startImport(db: Db, deps: Deps, ctx: OrgContext, file: { filename: string; bytes: Uint8Array }): Promise<string> {
  if (!file.bytes.byteLength) throw new ImportError("EMPTY");
  if (file.bytes.byteLength > IMPORT_MAX_BYTES) throw new ImportError("TOO_LARGE");
  const filename = (file.filename.split(/[\\/]/).pop() ?? "plan").normalize("NFC").replace(/[\u0000-\u001f]/g, "").slice(0, 200) || "plan";
  const type = sniff(file.bytes);
  const id = crypto.randomUUID();
  let row: Pick<ImportRow, "kind" | "tables" | "mappings" | "items" | "reader">;

  const isCsv = type === "text" && /\.(csv|tsv)$/i.test(filename);
  if (type === "xlsx" || isCsv) {
    let tables: PlanTable[];
    try {
      tables = type === "xlsx" ? tablesFromXlsx(file.bytes) : tablesFromCsv(new TextDecoder().decode(file.bytes));
    } catch {
      throw new ImportError("INVALID_FILE");
    }
    tables = tables.slice(0, MAX_SHEETS);
    if (!tables.length) throw new ImportError("NO_POSTS");
    const mappings: ColumnMapping[] = [];
    let reader: ImportRow["reader"] = { by: "headers" };
    for (const t of tables) {
      const guess = guessMapping(t.header, t.rows.slice(0, 8).map((r) => r.cells));
      // No platform column: the file or sheet name may say it ("CHERR.IO_X_posts.xlsx").
      if (!guess.columns.includes("platform")) guess.defaultPlatform = platformFromName(`${filename} ${t.sheet}`);
      const ai = await callAi(db, ctx, deps.llm, mappingRequest(t, filename, guess), MAPPING_MAX_TOKENS);
      const read = "input" in ai ? readMapping(ai.input, t.header.length) : null;
      if (read) reader = { by: "ai", model: ai.model };
      else if ("error" in ai) reader = { ...reader, error: ai.error };
      const chosen = read ?? guess;
      if (!chosen.columns.includes("platform") && !chosen.defaultPlatform) chosen.defaultPlatform = platformFromName(`${filename} ${t.sheet}`);
      mappings.push(chosen);
    }
    row = { kind: "table", tables, mappings, items: null, reader };
  } else if (type === "docx" || type === "pdf" || type === "text") {
    let text: string;
    try {
      text = await materialText(file.bytes, type);
    } catch (e) {
      throw new ImportError(e instanceof ExtractError && e.code === "NO_TEXT" ? "NO_POSTS" : "INVALID_FILE");
    }
    const ai = await callAi(db, ctx, deps.llm, extractRequest(text, filename), EXTRACT_MAX_TOKENS);
    if ("error" in ai) throw new ImportError("AI_FAILED", ai.error);
    const items = readExtraction(ai.input, text);
    if (!items) throw new ImportError("AI_FAILED", "INVALID_OUTPUT");
    if (!items.length) throw new ImportError("NO_POSTS");
    row = { kind: "document", tables: null, mappings: [], items, reader: { by: "ai", model: ai.model } };
  } else {
    throw new ImportError("UNSUPPORTED_TYPE", type);
  }

  const ext = type === "text" ? (isCsv ? "csv" : "txt") : type;
  const key = `org/${ctx.orgId}/imports/${id}.${ext}`;
  await deps.storage.put(key, file.bytes, isCsv ? "text/csv; charset=utf-8" : "application/octet-stream");
  await forOrg(db, ctx).insert(planImports, {
    id, filename, storageKey: key, sha256: createHash("sha256").update(file.bytes).digest("hex"), createdBy: ctx.userId, ...row,
  });
  return id;
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
 * - otherwise the only channel of the platform, but only when the org has a single brand (no other brand to mix up).
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
  return hint.brandCount === 1 && same.length === 1 ? same[0].id : null;
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
  const brandList = await db.select({ id: brands.id, name: brands.name, slug: brands.slug }).from(brands).where(and(eq(brands.orgId, ctx.orgId), sql`${brands.archivedAt} is null`));
  const hint = { brand: brandFromName(r.filename, brandList), brandCount: brandList.length };
  const map = r.settings.channelMap ?? {};
  const groups = new Map<string, { key: string; platform: string | null; account: string | null; count: number; channelId: string | null; suggested: string | null }>();
  for (const i of items) {
    const key = groupKey(i);
    const g = groups.get(key) ?? { key, platform: i.platform, account: i.account, count: 0, channelId: null, suggested: suggestChannel(i.platform, i.account, list, hint) };
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
  return { import: r, items, schedule: scheduleOf(items, r.settings), groups: [...groups.values()], channels: list, brand: hint.brand };
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
        await forOrg(t, ctx).delete(postMedia, eq(postMedia.postId, prev.id));
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
  if (r.status !== "draft") throw new ImportError("BAD_STATE");
  await forOrg(db, ctx).update(planImports, { status: "discarded" }, eq(planImports.id, id));
}

export async function listImports(db: Db, ctx: OrgContext, limit = 50) {
  return db
    .select({ id: planImports.id, filename: planImports.filename, kind: planImports.kind, status: planImports.status, createdCount: planImports.createdCount, createdAt: planImports.createdAt, reader: planImports.reader })
    .from(planImports).where(eq(planImports.orgId, ctx.orgId)).orderBy(desc(planImports.createdAt)).limit(limit);
}
