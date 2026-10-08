// Competitor analysis (TASK-050, spec §4.3 steps 2–5, ADR-066). Members upload screenshots of competitors' posts and
// ads; "Analiziraj" queues a run that reads each kept competitor's public website (SSRF-safe fetch) and asks Claude for
// a report: profiles, adopt / reject learnings with evidence, topic gaps. Members tick the learnings; the owner sends
// the accepted ones to the CGP as a pending draft (ADR-035/038: never the active CGP). Every report stays.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { cleanFilename, CGP_MAX_CHARS } from "../brands/files";
import { getBrandDetail } from "../brands/service";
import type { Db } from "../db/client";
import { cgpDrafts, competitorItems, competitorReports, competitorRuns, competitors, posts, type Learning } from "../db/schema";
import { fetchPublicFile, FetchError, type FetchFile } from "../files/fetch-public";
import { MAX_INPUT_PIXELS, reencodeImage } from "../files/images";
import { sniff } from "../files/sniff";
import type { Storage } from "../files/storage";
import { cappedCall, textModelFor } from "../llm/call";
import { worstCaseMicroUsd } from "../llm/cost";
import { SpendCapError } from "../llm/spend";
import { LlmError, type ImageBlock, type LlmClient } from "../llm/types";
import { resolveOrgContext, TenancyError, type OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { ANALYZE_MAX_COMPETITORS, analyzeRequest, IMAGES_MAX, IMAGES_PER_COMPETITOR, PAGE_IN_PROMPT, reportSchema } from "./ai";
import { htmlToText } from "./html";
import { CompetitorError } from "./service";

export const COMPETITOR_ANALYZE_QUEUE = "competitors-analyze";
export type CompetitorAnalyzeJob = { runId: string };
export const SCREENSHOT_MAX_BYTES = 10 * 1024 * 1024;
export const SCREENSHOTS_PER_COMPETITOR = 20;
const PAGE_MAX_BYTES = 3 * 1024 * 1024;
const STALE_MS = 20 * 60 * 1000;

type Item = typeof competitorItems.$inferSelect;
type Competitor = typeof competitors.$inferSelect;

async function competitorOf(db: Db, ctx: OrgContext, id: string) {
  const [c] = (await forOrg(db, ctx).select(competitors, eq(competitors.id, id))) as Competitor[];
  if (!c) throw new CompetitorError("NOT_FOUND");
  return c;
}

// ---- Screenshots ---------------------------------------------------------------------------------------------------

/** Any member adds a screenshot (a competitor's post, ad or carousel page) — re-encoded, metadata stripped. */
export async function uploadScreenshot(db: Db, storage: Storage, ctx: OrgContext, competitorId: string, file: { filename: string; bytes: Uint8Array }) {
  const c = await competitorOf(db, ctx, competitorId);
  const { brand } = await getBrandDetail(db, ctx, c.brandId);
  if (brand.archivedAt) throw new CompetitorError("ARCHIVED");
  if (file.bytes.byteLength > SCREENSHOT_MAX_BYTES) throw new CompetitorError("TOO_LARGE");
  if (!["png", "jpeg", "webp"].includes(sniff(file.bytes))) throw new CompetitorError("INVALID_FILE");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(competitorItems)
    .where(and(eq(competitorItems.orgId, ctx.orgId), eq(competitorItems.competitorId, c.id), eq(competitorItems.kind, "upload")));
  if (n >= SCREENSHOTS_PER_COMPETITOR) throw new CompetitorError("LIMIT_REACHED");
  let img;
  try {
    img = await reencodeImage(file.bytes, "image");
  } catch {
    throw new CompetitorError("INVALID_FILE");
  }
  const id = crypto.randomUUID();
  const key = `org/${ctx.orgId}/competitors/${c.id}/${id}.${img.ext}`;
  await storage.put(key, img.bytes, img.contentType);
  try {
    await forOrg(db, ctx).insert(competitorItems, { id, competitorId: c.id, kind: "upload", storageKey: key, filename: cleanFilename(file.filename), width: img.width, height: img.height, createdBy: ctx.userId });
  } catch (e) {
    await storage.delete(key).catch(() => undefined);
    throw e;
  }
  return id;
}

/** Any member deletes a screenshot on purpose (fetched pages are refreshed by Postaja, not deleted by hand). */
export async function deleteScreenshot(db: Db, storage: Storage, ctx: OrgContext, itemId: string) {
  const gone = (await forOrg(db, ctx).delete(competitorItems, and(eq(competitorItems.id, itemId), eq(competitorItems.kind, "upload"))!)) as Item[];
  if (!gone.length) throw new CompetitorError("NOT_FOUND");
  if (gone[0].storageKey) await storage.delete(gone[0].storageKey).catch(() => undefined);
}

/** A short-lived link to a screenshot for a member of its organization. */
export async function screenshotUrl(db: Db, storage: Storage, ctx: OrgContext, itemId: string) {
  const [i] = (await forOrg(db, ctx).select(competitorItems, and(eq(competitorItems.id, itemId), eq(competitorItems.kind, "upload"))!)) as Item[];
  if (!i?.storageKey) throw new CompetitorError("NOT_FOUND");
  const jpg = i.storageKey.endsWith(".jpg");
  return storage.presignGet(i.storageKey, { filename: i.filename ?? `screenshot.${jpg ? "jpg" : "png"}`, contentType: jpg ? "image/jpeg" : "image/png", inline: true });
}

/** Everything collected per competitor of a brand (page text left out). Any member. */
export async function listItems(db: Db, ctx: OrgContext, brandId: string) {
  const ids = ((await forOrg(db, ctx).select(competitors, eq(competitors.brandId, brandId))) as Competitor[]).map((c) => c.id);
  if (!ids.length) return new Map<string, (Omit<Item, "text"> & { chars: number })[]>();
  const rows = (await forOrg(db, ctx).select(competitorItems, inArray(competitorItems.competitorId, ids))) as Item[];
  const out = new Map<string, (Omit<Item, "text"> & { chars: number })[]>();
  for (const r of rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    const { text, ...rest } = r;
    out.set(r.competitorId, [...(out.get(r.competitorId) ?? []), { ...rest, chars: text?.length ?? 0 }]);
  }
  return out;
}

// ---- Analysis run --------------------------------------------------------------------------------------------------

/** Any member: one run per brand at a time (shared with "find"), at least one kept competitor. */
export async function requestAnalyze(db: Db, queue: { send(name: string, data: object, key: string): Promise<void> }, ctx: OrgContext, brandId: string) {
  const { brand } = await getBrandDetail(db, ctx, brandId).catch(() => { throw new CompetitorError("NOT_FOUND"); });
  if (brand.archivedAt) throw new CompetitorError("ARCHIVED");
  const kept = (await forOrg(db, ctx).select(competitors, and(eq(competitors.brandId, brandId), eq(competitors.status, "kept"))!)) as Competitor[];
  if (!kept.length) throw new CompetitorError("NO_COMPETITORS");
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from brands where id = ${brandId} for update`);
    const [busy] = await tx.select({ id: competitorRuns.id }).from(competitorRuns).where(and(
      eq(competitorRuns.brandId, brandId), inArray(competitorRuns.status, ["queued", "running"]),
      sql`${competitorRuns.updatedAt} > now() - make_interval(secs => ${STALE_MS / 1000})`,
    ));
    if (busy) throw new CompetitorError("BUSY");
    await forOrg(tx as unknown as Db, ctx).insert(competitorRuns, { id, brandId, kind: "analyze", requestedBy: ctx.userId });
  });
  await queue.send(COMPETITOR_ANALYZE_QUEUE, { runId: id } satisfies CompetitorAnalyzeJob, `competitors:${brandId}`);
  return id;
}

/** Reads one public website; the outcome (text or the reason it failed) replaces the competitor's earlier page. */
async function readWebsite(db: Db, ctx: OrgContext, fetchFile: FetchFile, c: Competitor): Promise<{ url: string; title: string; text: string } | null> {
  if (!c.website) return null;
  let title = "", text = "", error: string | null = null;
  try {
    const f = await fetchFile(c.website, { maxBytes: PAGE_MAX_BYTES, timeoutMs: 15_000 });
    const html = new TextDecoder("utf-8", { fatal: false }).decode(f.bytes);
    if (!/html/i.test(f.contentType ?? "") && !/^\s*</.test(html)) error = "NOT_HTML";
    else {
      ({ title, text } = htmlToText(html));
      if (text.length < 50) error = "NO_TEXT";
    }
  } catch (e) {
    error = e instanceof FetchError ? e.code : "NETWORK";
  }
  await db.transaction(async (tx) => {
    const s = forOrg(tx as unknown as Db, ctx);
    await s.delete(competitorItems, and(eq(competitorItems.competitorId, c.id), eq(competitorItems.kind, "web_page"))!);
    await s.insert(competitorItems, { id: crypto.randomUUID(), competitorId: c.id, kind: "web_page", url: c.website, title: title || null, text: error ? null : text, error, createdBy: ctx.userId });
  });
  return error ? null : { url: c.website, title, text };
}

/** A screenshot as a small JPEG for Claude (longest side 1024). */
async function toBlock(bytes: Uint8Array, caption: string): Promise<ImageBlock> {
  const jpg = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 80 }).toBuffer();
  return { mediaType: "image/jpeg", data: jpg.toString("base64"), caption };
}

export type AnalyzeDeps = { llm: LlmClient; storage: Storage; fetchFile?: FetchFile; now?: Date };

/** Worker side: acts as the member who asked (re-verified); failures are stored on the run. */
export async function runAnalyzeJob(db: Db, deps: AnalyzeDeps, job: CompetitorAnalyzeJob): Promise<"done" | "failed" | "skipped"> {
  const [run] = await db.select().from(competitorRuns).where(eq(competitorRuns.id, job.runId));
  if (!run || run.kind !== "analyze" || run.status === "done" || run.status === "failed") return "skipped";
  const fail = async (code: string) => {
    await db.update(competitorRuns).set({ status: "failed", error: code.slice(0, 300), updatedAt: new Date() }).where(eq(competitorRuns.id, run.id));
    return "failed" as const;
  };
  let ctx: OrgContext;
  try {
    if (!run.requestedBy) return fail("NO_ACCESS");
    ctx = await resolveOrgContext(db, { userId: run.requestedBy, activeOrganizationId: run.orgId });
  } catch (e) {
    if (e instanceof TenancyError) return fail("NO_ACCESS");
    throw e;
  }
  await db.update(competitorRuns).set({ status: "running", updatedAt: new Date() }).where(eq(competitorRuns.id, run.id));
  const { brand, profile } = await getBrandDetail(db, ctx, run.brandId);
  const kept = ((await forOrg(db, ctx).select(competitors, and(eq(competitors.brandId, run.brandId), eq(competitors.status, "kept"))!).orderBy(asc(competitors.createdAt))) as Competitor[])
    .slice(0, ANALYZE_MAX_COMPETITORS);
  if (!kept.length) return fail("NO_COMPETITORS");

  const images: ImageBlock[] = [];
  const inputs = [];
  for (const c of kept) {
    const page = await readWebsite(db, ctx, deps.fetchFile ?? fetchPublicFile, c);
    const shots = ((await forOrg(db, ctx).select(competitorItems, and(eq(competitorItems.competitorId, c.id), eq(competitorItems.kind, "upload"))!).orderBy(desc(competitorItems.createdAt))) as Item[])
      .slice(0, Math.min(IMAGES_PER_COMPETITOR, IMAGES_MAX - images.length));
    for (const [n, s] of shots.entries()) images.push(await toBlock(await deps.storage.get(s.storageKey!), `${c.name} — screenshot ${n + 1}:`));
    inputs.push({ name: c.name, website: c.website, reason: c.reason, page, screenshots: shots.length });
  }
  const recent = await db.select({ topic: posts.topicSummary, plan: posts.plan, brief: posts.brief }).from(posts)
    .where(and(eq(posts.orgId, run.orgId), eq(posts.brandId, run.brandId))).orderBy(desc(posts.createdAt)).limit(40);
  const ourTopics = recent.map((p) => (p.topic ?? p.plan?.topic ?? p.brief ?? "").slice(0, 160)).filter(Boolean);
  const req = analyzeRequest({ brandName: brand.name, language: brand.languages[0] ?? "sl", cgp: profile?.cgp ?? "", ourTopics, competitors: inputs }, images);
  let out;
  try {
    out = await cappedCall(db, deps.llm, { orgId: run.orgId, brandId: run.brandId, postId: null, now: deps.now, action: "research" }, req);
  } catch (e) {
    if (e instanceof SpendCapError) return fail("SPEND_CAP");
    if (e instanceof LlmError) return fail(e.message && e.message !== e.code ? `AI_FAILED:${e.message}` : "AI_FAILED");
    throw e;
  }
  const parsed = reportSchema.safeParse(out.input);
  if (!parsed.success) return fail("INVALID_OUTPUT");
  const r = parsed.data;
  const learnings: Learning[] = [
    ...r.adopt.map((l) => ({ ...l, id: crypto.randomUUID(), kind: "adopt" as const, decision: null })),
    ...r.reject.map((l) => ({ ...l, id: crypto.randomUUID(), kind: "reject" as const, decision: null })),
  ];
  const reportId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await forOrg(tx as unknown as Db, ctx).insert(competitorReports, { id: reportId, brandId: run.brandId, summary: r.summary, profiles: r.competitors, learnings, gaps: r.gaps, model: out.model, createdBy: ctx.userId });
    await tx.update(competitorRuns).set({ status: "done", reportId, model: out.model, error: null, updatedAt: new Date() }).where(eq(competitorRuns.id, run.id));
  });
  return "done";
}

/** The most an analysis can cost: every kept competitor's page text and screenshots, and the answer. */
export async function analyzeEstimate(db: Db, ctx: OrgContext, brandId: string): Promise<bigint> {
  const { profile } = await getBrandDetail(db, ctx, brandId);
  const n = Math.min(ANALYZE_MAX_COMPETITORS, ((await forOrg(db, ctx).select(competitors, and(eq(competitors.brandId, brandId), eq(competitors.status, "kept"))!)) as Competitor[]).length);
  const model = await textModelFor(db, brandId);
  const chars = 6_000 + (profile?.cgp.length ?? 0) + n * (PAGE_IN_PROMPT + 1_000) + Math.min(IMAGES_MAX, n * IMAGES_PER_COMPETITOR) * 1600 * 3;
  return worstCaseMicroUsd(chars, 8000, model);
}

// ---- Reports, decisions, CGP proposal -------------------------------------------------------------------------------

/** The brand's reports, newest first. Any member. */
export async function listReports(db: Db, ctx: OrgContext, brandId: string) {
  return (await forOrg(db, ctx).select(competitorReports, eq(competitorReports.brandId, brandId)).orderBy(desc(competitorReports.createdAt))) as (typeof competitorReports.$inferSelect)[];
}

async function reportOf(db: Db, ctx: OrgContext, id: string) {
  const [r] = (await forOrg(db, ctx).select(competitorReports, eq(competitorReports.id, id))) as (typeof competitorReports.$inferSelect)[];
  if (!r) throw new CompetitorError("NOT_FOUND");
  return r;
}

/** Any member ticks a learning: yes (we take it), no, or undecided again. */
export async function decideLearning(db: Db, ctx: OrgContext, reportId: string, learningId: string, decision: "yes" | "no" | null) {
  z.enum(["yes", "no"]).nullable().parse(decision);
  const r = await reportOf(db, ctx, reportId);
  if (!r.learnings.some((l) => l.id === learningId)) throw new CompetitorError("NOT_FOUND");
  const learnings = r.learnings.map((l) => (l.id === learningId ? { ...l, decision } : l));
  await forOrg(db, ctx).update(competitorReports, { learnings }, eq(competitorReports.id, r.id));
}

/** The text appended to the CGP for the accepted learnings. */
export function learningsSection(learnings: Learning[], date: string): string {
  const yes = learnings.filter((l) => l.decision === "yes");
  const part = (kind: Learning["kind"], head: string) => {
    const items = yes.filter((l) => l.kind === kind);
    return items.length ? [`### ${head}`, ...items.map((l) => `- ${l.title}: ${l.why}`)].join("\n") : "";
  };
  return [`## Iz analize konkurence (${date})`, part("adopt", "Prevzamemo"), part("reject", "Ne delamo")].filter(Boolean).join("\n\n");
}

/**
 * Owner only: the accepted learnings, added to the current CGP, become the brand's pending CGP draft (an earlier pending
 * draft is replaced). The owner reviews it on the profile tab and saves a version — the CGP never changes by itself.
 */
export async function sendLearningsToCgp(db: Db, ctx: OrgContext, reportId: string, today: string) {
  if (ctx.role !== "owner") throw new CompetitorError("FORBIDDEN");
  const r = await reportOf(db, ctx, reportId);
  if (!r.learnings.some((l) => l.decision === "yes")) throw new CompetitorError("NOTHING_ACCEPTED");
  const { brand, profile } = await getBrandDetail(db, ctx, r.brandId);
  if (brand.archivedAt) throw new CompetitorError("ARCHIVED");
  const text = [profile?.cgp.trim() ?? "", learningsSection(r.learnings, today)].filter(Boolean).join("\n\n");
  if (text.length > CGP_MAX_CHARS) throw new CompetitorError("TOO_LONG");
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    const t = forOrg(tx as unknown as Db, ctx);
    await t.update(cgpDrafts, { status: "discarded", resolvedAt: new Date() }, and(eq(cgpDrafts.brandId, r.brandId), eq(cgpDrafts.status, "pending"))!);
    await t.insert(cgpDrafts, { id, brandId: r.brandId, text, note: "Analiza konkurence", source: "competitors", createdBy: ctx.userId });
    await t.update(competitorReports, { draftId: id }, eq(competitorReports.id, r.id));
  });
  return id;
}
