// Bulk creation (TASK-014, ADR-042): pick the planned posts of a day (all brands or one) or of a brand over a range,
// queue one job per post, and let workers write them. Every post is claimed before it is written, so a retried job,
// a second run or a person clicking "Napiši besedilo" can never write the same post twice. Costs stay under the cap.
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { isIsoDate } from "@/lib/dates";
import type { Db } from "../db/client";
import { brands, bulkItems, bulkRuns, posts, type BulkScope } from "../db/schema";
import { generateForPost, PostError, type GenerateDeps } from "../posts/generate";
import { resolveOrgContext, TenancyError, type OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";

export const BULK_MAX = 200;
export const POST_TEXT_QUEUE = "post-text";
export type PostTextJob = { itemId: string };
/** Where jobs go; pg-boss in the app, an in-memory stand-in in tests. */
export type JobQueue = { send(name: typeof POST_TEXT_QUEUE, data: PostTextJob, key: string): Promise<void> };

export class BulkError extends Error {
  constructor(public readonly code: "NOTHING_TO_DO" | "TOO_MANY" | "NOT_FOUND" | "BAD_STATE" | "INVALID", public readonly detail?: string) {
    super(code);
  }
}

const date = z.string().refine((s) => isIsoDate(s));
export const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("day"), date, brandId: z.string().min(1).nullish() }),
  z.object({ kind: z.literal("brand"), brandId: z.string().min(1), from: date, to: date.nullable() }),
]);

/** Planned posts (or failed ones) without text, with a channel, of live brands in the scope — this org only. */
export async function bulkCandidates(db: Db, ctx: OrgContext, scope: BulkScope): Promise<string[]> {
  const s = scopeSchema.parse(scope);
  const where = [
    eq(posts.orgId, ctx.orgId),
    inArray(posts.status, ["planned", "failed"]),
    isNull(posts.content),
    isNotNull(posts.channelId),
  ];
  if (s.kind === "day") {
    where.push(eq(posts.scheduledOn, s.date));
    if (s.brandId) where.push(eq(posts.brandId, s.brandId));
  } else {
    where.push(eq(posts.brandId, s.brandId), gte(posts.scheduledOn, s.from));
    if (s.to) where.push(lte(posts.scheduledOn, s.to));
  }
  const rows = await db
    .select({ id: posts.id })
    .from(posts)
    .innerJoin(brands, and(eq(brands.id, posts.brandId), eq(brands.orgId, ctx.orgId), isNull(brands.archivedAt)))
    .where(and(...where))
    .orderBy(posts.scheduledOn, sql`${posts.scheduledTime} asc nulls last`, posts.createdAt)
    .limit(BULK_MAX + 1);
  return rows.map((r) => r.id);
}

/** Creates the run and its items, then queues one job per item. Any member may start one (the cap protects cost). */
export async function startBulk(db: Db, queue: JobQueue, ctx: OrgContext, scope: BulkScope): Promise<string> {
  const s = scopeSchema.parse(scope) as BulkScope;
  const ids = await bulkCandidates(db, ctx, s);
  if (!ids.length) throw new BulkError("NOTHING_TO_DO");
  if (ids.length > BULK_MAX) throw new BulkError("TOO_MANY", String(BULK_MAX));
  const runId = crypto.randomUUID();
  const items = ids.map((postId) => ({ id: crypto.randomUUID(), runId, postId, step: "text" as const }));
  await db.transaction(async (tx) => {
    const t = forOrg(tx as unknown as Db, ctx);
    await t.insert(bulkRuns, { id: runId, brandId: s.brandId ?? null, scope: s, steps: ["text"], total: items.length, createdBy: ctx.userId });
    for (const it of items) await t.insert(bulkItems, it);
  });
  for (const it of items) await queue.send(POST_TEXT_QUEUE, { itemId: it.id }, `post:${it.postId}:text`);
  return runId;
}

async function finishRunIfDone(db: Db, runId: string) {
  await db.execute(sql`
    update bulk_runs set status = 'done', finished_at = now()
    where id = ${runId} and status in ('queued','running')
      and not exists (select 1 from bulk_items where run_id = ${runId} and status in ('queued','running'))`);
}

/**
 * Worker side: one item. The run's creator acts again with a freshly verified org context (removed member or
 * suspended org → the item fails). Never throws for an expected outcome, so the queue does not retry it.
 */
export async function runBulkItem(db: Db, deps: GenerateDeps, job: PostTextJob): Promise<"done" | "skipped" | "failed"> {
  const [item] = await db.select().from(bulkItems).where(eq(bulkItems.id, job.itemId));
  if (!item) return "skipped";
  const [run] = await db.select().from(bulkRuns).where(eq(bulkRuns.id, item.runId));
  const set = async (status: "done" | "skipped" | "failed", error: string | null = null) => {
    await db.update(bulkItems).set({ status, error, updatedAt: new Date() }).where(eq(bulkItems.id, item.id));
    await finishRunIfDone(db, item.runId);
    return status;
  };
  if (!run || run.status === "cancelled") return item.status === "queued" ? set("skipped", "CANCELLED") : "skipped";
  // Claim: only a queued item is worked on (a retried job after a crash finds it "running" and takes it over once).
  const claimed = await db
    .update(bulkItems)
    .set({ status: "running", attempts: sql`${bulkItems.attempts} + 1`, updatedAt: new Date() })
    .where(and(eq(bulkItems.id, item.id), sql`(${bulkItems.status} = 'queued' or (${bulkItems.status} = 'running' and ${bulkItems.attempts} < 2))`))
    .returning({ id: bulkItems.id });
  if (!claimed.length) return "skipped";
  await db.update(bulkRuns).set({ status: "running" }).where(and(eq(bulkRuns.id, run.id), eq(bulkRuns.status, "queued")));

  let ctx: OrgContext;
  try {
    ctx = await resolveOrgContext(db, { userId: run.createdBy, activeOrganizationId: run.orgId });
  } catch (e) {
    if (e instanceof TenancyError) return set("failed", "NO_ACCESS");
    throw e;
  }
  try {
    const outcome = await generateForPost(db, deps, ctx, item.postId);
    if (outcome === "skipped") return set("skipped", "HAS_TEXT");
    const [p] = await db.select({ status: posts.status, error: posts.error }).from(posts).where(eq(posts.id, item.postId));
    return p?.status === "failed" ? set("failed", p.error ?? "FAILED") : set("done");
  } catch (e) {
    if (e instanceof PostError) return set("failed", e.code);
    // Unexpected (database, network): mark the item and let the queue retry the job once.
    await db.update(bulkItems).set({ status: "queued", error: "RETRY", updatedAt: new Date() }).where(eq(bulkItems.id, item.id));
    await db.update(posts).set({ status: "planned" }).where(and(eq(posts.id, item.postId), eq(posts.status, "generating"), isNull(posts.content)));
    throw e;
  }
}

/** Stops a run: queued items are skipped; items already being written finish. */
export async function cancelBulk(db: Db, ctx: OrgContext, runId: string) {
  const rows = await forOrg(db, ctx).update(bulkRuns, { status: "cancelled", finishedAt: new Date() }, and(eq(bulkRuns.id, runId), inArray(bulkRuns.status, ["queued", "running"]))!);
  if (!rows.length) throw new BulkError("BAD_STATE");
  await forOrg(db, ctx).update(bulkItems, { status: "skipped", error: "CANCELLED", updatedAt: new Date() }, and(eq(bulkItems.runId, runId), eq(bulkItems.status, "queued"))!);
}

export type BulkRunView = Awaited<ReturnType<typeof listBulkRuns>>[number];

/** Recent runs with per-status counts and the brand name. */
export async function listBulkRuns(db: Db, ctx: OrgContext, limit = 20) {
  const runs = await db
    .select({ id: bulkRuns.id, status: bulkRuns.status, scope: bulkRuns.scope, total: bulkRuns.total, createdAt: bulkRuns.createdAt, finishedAt: bulkRuns.finishedAt, brandName: brands.name })
    .from(bulkRuns)
    .leftJoin(brands, and(eq(brands.id, bulkRuns.brandId), eq(brands.orgId, ctx.orgId)))
    .where(eq(bulkRuns.orgId, ctx.orgId))
    .orderBy(desc(bulkRuns.createdAt))
    .limit(limit);
  if (!runs.length) return [];
  const counts = await db
    .select({ runId: bulkItems.runId, status: bulkItems.status, n: sql<number>`count(*)::int` })
    .from(bulkItems)
    .where(and(eq(bulkItems.orgId, ctx.orgId), inArray(bulkItems.runId, runs.map((r) => r.id))))
    .groupBy(bulkItems.runId, bulkItems.status);
  return runs.map((r) => {
    const c = { queued: 0, running: 0, done: 0, skipped: 0, failed: 0 };
    for (const x of counts) if (x.runId === r.id) c[x.status] = x.n;
    return { ...r, counts: c };
  });
}

export async function getBulkRun(db: Db, ctx: OrgContext, runId: string) {
  const [r] = (await forOrg(db, ctx).select(bulkRuns, eq(bulkRuns.id, runId))) as (typeof bulkRuns.$inferSelect)[];
  if (!r) throw new BulkError("NOT_FOUND");
  return r;
}
