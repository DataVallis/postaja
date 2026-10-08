// Competitors of a brand (TASK-049, spec §4.3, ADR-066). "Najdi konkurente" queues a run; the worker asks Claude (web
// search + CGP) as the member who asked and stores new suggestions (known ones are skipped). Members keep or remove
// suggestions and add their own; nothing is removed unless a member removes it.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getBrandDetail } from "../brands/service";
import type { Db } from "../db/client";
import { competitorRuns, competitors, COMPETITOR_PLATFORMS, type CompetitorHandle } from "../db/schema";
import { cappedCall, textModelFor } from "../llm/call";
import { WEB_SEARCH_MICRO_USD, worstCaseMicroUsd } from "../llm/cost";
import { SpendCapError } from "../llm/spend";
import { LlmError, type LlmClient } from "../llm/types";
import { resolveOrgContext, TenancyError, type OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { FIND_SEARCHES, findRequest, foundSchema, publicUrl } from "./ai";

export const COMPETITOR_FIND_QUEUE = "competitors-find";
export type CompetitorFindJob = { runId: string };
export const COMPETITORS_MAX = 40;
const STALE_MS = 15 * 60 * 1000;

export class CompetitorError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND" | "INVALID" | "BUSY" | "ARCHIVED" | "LIMIT_REACHED" | "DUPLICATE" | "FORBIDDEN"
      | "TOO_LARGE" | "INVALID_FILE" | "NO_COMPETITORS" | "NOTHING_ACCEPTED" | "TOO_LONG",
    public readonly detail?: string,
  ) {
    super(code);
  }
}

/** "www.Example.si/" and "https://example.si" are the same site. */
export function siteKey(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
const nameKey = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

async function brandOf(db: Db, ctx: OrgContext, brandId: string) {
  const { brand, profile } = await getBrandDetail(db, ctx, brandId).catch(() => { throw new CompetitorError("NOT_FOUND"); });
  return { brand, profile };
}

/** The brand's competitors (kept first, then suggestions) and its latest find run. Any member. */
export async function listCompetitors(db: Db, ctx: OrgContext, brandId: string) {
  await brandOf(db, ctx, brandId);
  const rows = (await forOrg(db, ctx).select(competitors, eq(competitors.brandId, brandId))) as (typeof competitors.$inferSelect)[];
  rows.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name, "sl") : a.status === "kept" ? -1 : 1));
  const [run] = (await forOrg(db, ctx).select(competitorRuns, eq(competitorRuns.brandId, brandId)).orderBy(desc(competitorRuns.createdAt)).limit(1)) as (typeof competitorRuns.$inferSelect)[];
  return { competitors: rows, run: run ?? null };
}

/** Any member: Claude looks for competitors (one run per brand at a time; a run stuck for 15 minutes no longer blocks). */
export async function requestFind(db: Db, queue: { send(name: string, data: object, key: string): Promise<void> }, ctx: OrgContext, brandId: string, hint = "") {
  const { brand } = await brandOf(db, ctx, brandId);
  if (brand.archivedAt) throw new CompetitorError("ARCHIVED");
  const wish = z.string().trim().max(1000).safeParse(hint);
  if (!wish.success) throw new CompetitorError("INVALID");
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from brands where id = ${brandId} for update`);
    const [busy] = await tx.select({ id: competitorRuns.id }).from(competitorRuns).where(and(
      eq(competitorRuns.brandId, brandId), inArray(competitorRuns.status, ["queued", "running"]),
      sql`${competitorRuns.updatedAt} > now() - make_interval(secs => ${STALE_MS / 1000})`,
    ));
    if (busy) throw new CompetitorError("BUSY");
    await forOrg(tx as unknown as Db, ctx).insert(competitorRuns, { id, brandId, kind: "find", hint: wish.data, requestedBy: ctx.userId });
  });
  await queue.send(COMPETITOR_FIND_QUEUE, { runId: id } satisfies CompetitorFindJob, `competitors:${brandId}`);
  return id;
}

/** Cleans what Claude found: valid public URLs only, no duplicates of known competitors or of each other. */
export function newSuggestions(found: z.infer<typeof foundSchema>["competitors"], known: { name: string; website: string | null }[]) {
  const sites = new Set(known.map((k) => siteKey(k.website)).filter(Boolean));
  const names = new Set(known.map((k) => nameKey(k.name)));
  const out: { name: string; website: string | null; handles: CompetitorHandle[]; reason: string }[] = [];
  for (const c of found) {
    const site = c.website ? publicUrl.safeParse(c.website) : null;
    const website = site?.success ? site.data : null;
    const key = siteKey(website);
    if ((key && sites.has(key)) || names.has(nameKey(c.name))) continue;
    const handles = c.handles.flatMap((h) => { const u = publicUrl.safeParse(h.url); return u.success ? [{ platform: h.platform, url: u.data }] : []; });
    out.push({ name: c.name, website, handles, reason: c.reason });
    if (key) sites.add(key);
    names.add(nameKey(c.name));
  }
  return out;
}

export type FindDeps = { llm: LlmClient; now?: Date };

/** Worker side: acts as the member who asked (re-verified); failures are stored on the run. */
export async function runFindJob(db: Db, deps: FindDeps, job: CompetitorFindJob): Promise<"done" | "failed" | "skipped"> {
  const [run] = await db.select().from(competitorRuns).where(eq(competitorRuns.id, job.runId));
  if (!run || run.status === "done" || run.status === "failed") return "skipped";
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
  const { brand, profile } = await brandOf(db, ctx, run.brandId);
  const known = ((await forOrg(db, ctx).select(competitors, eq(competitors.brandId, run.brandId))) as (typeof competitors.$inferSelect)[])
    .map((c) => ({ name: c.name, website: c.website }));
  const req = findRequest({ brandName: brand.name, website: brand.website, languages: brand.languages, cgp: profile?.cgp ?? "", hint: run.hint, known });
  let out;
  try {
    out = await cappedCall(db, deps.llm, { orgId: run.orgId, brandId: run.brandId, postId: null, now: deps.now }, req);
  } catch (e) {
    if (e instanceof SpendCapError) return fail("SPEND_CAP");
    if (e instanceof LlmError) return fail(e.message && e.message !== e.code ? `AI_FAILED:${e.message}` : "AI_FAILED");
    throw e;
  }
  const parsed = foundSchema.safeParse(out.input);
  if (!parsed.success) return fail("INVALID_OUTPUT");
  const room = Math.max(0, COMPETITORS_MAX - known.length);
  const fresh = newSuggestions(parsed.data.competitors, known).slice(0, room);
  await db.transaction(async (tx) => {
    const s = forOrg(tx as unknown as Db, ctx);
    for (const c of fresh) await s.insert(competitors, { id: crypto.randomUUID(), brandId: run.brandId, ...c, source: "ai", status: "suggested", createdBy: ctx.userId });
    await tx.update(competitorRuns).set({ status: "done", added: fresh.length, model: out.model, error: null, updatedAt: new Date() }).where(eq(competitorRuns.id, run.id));
  });
  return "done";
}

const manualInput = z.object({
  name: z.string().trim().min(1).max(120),
  website: z.union([z.literal(""), publicUrl]).optional(),
  handles: z.array(z.object({ platform: z.enum(COMPETITOR_PLATFORMS), url: publicUrl })).max(6).default([]),
  reason: z.string().trim().max(600).default(""),
});

/** Any member adds a competitor of their own (kept). */
export async function addCompetitor(db: Db, ctx: OrgContext, brandId: string, input: z.input<typeof manualInput>) {
  const { brand } = await brandOf(db, ctx, brandId);
  if (brand.archivedAt) throw new CompetitorError("ARCHIVED");
  const r = manualInput.safeParse(input);
  if (!r.success) throw new CompetitorError("INVALID", r.error.issues[0]?.message);
  const existing = (await forOrg(db, ctx).select(competitors, eq(competitors.brandId, brandId))) as (typeof competitors.$inferSelect)[];
  if (existing.length >= COMPETITORS_MAX) throw new CompetitorError("LIMIT_REACHED");
  const website = r.data.website || null;
  if (!newSuggestions([{ ...r.data, website, handles: [], reason: "-" }], existing).length) throw new CompetitorError("DUPLICATE");
  const id = crypto.randomUUID();
  await forOrg(db, ctx).insert(competitors, { id, brandId, name: r.data.name, website, handles: r.data.handles, reason: r.data.reason, source: "manual", status: "kept", createdBy: ctx.userId });
  return id;
}

/** Any member keeps a suggestion. */
export async function keepCompetitor(db: Db, ctx: OrgContext, id: string) {
  const done = await forOrg(db, ctx).update(competitors, { status: "kept", updatedAt: new Date() }, eq(competitors.id, id));
  if (!done.length) throw new CompetitorError("NOT_FOUND");
}

/** Any member removes a competitor (a suggestion or a kept one) on purpose. */
export async function removeCompetitor(db: Db, ctx: OrgContext, id: string) {
  const gone = await forOrg(db, ctx).delete(competitors, eq(competitors.id, id));
  if (!gone.length) throw new CompetitorError("NOT_FOUND");
}

/** The most one "Najdi konkurente" can cost (reserved against the spend cap): searches, their results and the answer. */
export async function findEstimate(db: Db, ctx: OrgContext, brandId: string): Promise<bigint> {
  const { profile } = await brandOf(db, ctx, brandId);
  const model = await textModelFor(db, brandId);
  const req = findRequest({ brandName: "", website: null, languages: ["sl"], cgp: profile?.cgp ?? "", hint: "", known: [] });
  const chars = req.system[0].text.length + req.user.length + JSON.stringify(req.tool).length + FIND_SEARCHES * 30_000 * 3;
  return worstCaseMicroUsd(chars, req.maxTokens, model) + BigInt(FIND_SEARCHES) * WEB_SEARCH_MICRO_USD;
}
