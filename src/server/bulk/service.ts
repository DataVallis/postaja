// Bulk creation (TASK-014, ADR-042; images TASK-015): pick the planned posts of a day (all brands or one) or of a brand
// over a range, queue one job per post and step (text, images), and let workers do them. Every post is claimed before
// it is worked on, so a retried job, a second run or a person clicking a button can never do the same post twice.
// Costs stay under the cap.
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { isIsoDate } from "@/lib/dates";
import type { Db } from "../db/client";
import { brands, bulkItems, bulkRuns, posts, type BulkScope, type BulkStep } from "../db/schema";
import { imageFailureCode, POST_IMAGE_QUEUE, renderPostImages, type ImageDeps, type PostImageJob } from "../images/service";
import { generateForPost, PostError, type GenerateDeps } from "../posts/generate";
import { resolveOrgContext, TenancyError, type OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";

export const BULK_MAX = 200;
export const POST_TEXT_QUEUE = "post-text";
export type PostTextJob = { itemId: string };
export type QueueJob = PostTextJob | PostImageJob;
/** Where jobs go; pg-boss in the app, an in-memory stand-in in tests. */
export type JobQueue = { send(name: string, data: QueueJob | { designId: string }, key: string): Promise<void> };
export const BULK_STEPS = ["text", "image"] as const;

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

/**
 * Text: planned (or failed) posts without text. Images: posts without images yet (or whose images failed), not skipped
 * or published, of brands that have a design. Both: with a channel, of live brands in the scope — this org only.
 */
export async function bulkCandidates(db: Db, ctx: OrgContext, scope: BulkScope, step: BulkStep = "text"): Promise<string[]> {
  const s = scopeSchema.parse(scope);
  const where = [
    eq(posts.orgId, ctx.orgId),
    isNotNull(posts.channelId),
    ...(step === "text"
      ? [inArray(posts.status, ["planned", "failed"]), isNull(posts.content)]
      : [notInArray(posts.status, ["skipped", "published"]), inArray(posts.mediaStatus, ["none", "failed"])]),
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
    // Images need the brand's design (TASK-017): brands without one are left out of the image step.
    .innerJoin(brands, and(eq(brands.id, posts.brandId), eq(brands.orgId, ctx.orgId), isNull(brands.archivedAt), ...(step === "image" ? [isNotNull(brands.currentDesignId)] : [])))
    .where(and(...where))
    .orderBy(posts.scheduledOn, sql`${posts.scheduledTime} asc nulls last`, posts.createdAt)
    .limit(BULK_MAX + 1);
  return rows.map((r) => r.id);
}

/** Creates the run and its items, then queues one job per item. Any member may start one (the cap protects cost). */
export async function startBulk(db: Db, queue: JobQueue, ctx: OrgContext, scope: BulkScope, steps: BulkStep[] = ["text"]): Promise<string> {
  const s = scopeSchema.parse(scope) as BulkScope;
  const chosen = BULK_STEPS.filter((x) => steps.includes(x));
  if (!chosen.length) throw new BulkError("INVALID");
  const runId = crypto.randomUUID();
  const items: { id: string; runId: string; postId: string; step: BulkStep }[] = [];
  for (const step of chosen) {
    for (const postId of await bulkCandidates(db, ctx, s, step)) items.push({ id: crypto.randomUUID(), runId, postId, step });
  }
  if (!items.length) throw new BulkError("NOTHING_TO_DO");
  if (items.length > BULK_MAX) throw new BulkError("TOO_MANY", String(BULK_MAX));
  await db.transaction(async (tx) => {
    const t = forOrg(tx as unknown as Db, ctx);
    await t.insert(bulkRuns, { id: runId, brandId: s.brandId ?? null, scope: s, steps: chosen, total: items.length, createdBy: ctx.userId });
    for (const it of items) await t.insert(bulkItems, it);
  });
  for (const it of items) {
    await queue.send(it.step === "text" ? POST_TEXT_QUEUE : POST_IMAGE_QUEUE, { itemId: it.id }, `post:${it.postId}:${it.step}`);
  }
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
export async function runBulkItem(db: Db, deps: GenerateDeps & { images?: ImageDeps["images"] }, job: PostTextJob): Promise<"done" | "skipped" | "failed"> {
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
  if (item.step === "image") return runImageItem(db, deps, ctx, item.id, item.postId, set);
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

/** One post's images inside a run: claim the post's images (none/failed only), render, record the outcome. */
async function runImageItem(
  db: Db, deps: GenerateDeps & { images?: ImageDeps["images"] }, ctx: OrgContext, itemId: string, postId: string,
  set: (status: "done" | "skipped" | "failed", error?: string | null) => Promise<"done" | "skipped" | "failed">,
) {
  const claimed = await db
    .update(posts)
    .set({ mediaStatus: "rendering", mediaError: null, mediaRequestedBy: ctx.userId, updatedAt: new Date() })
    .where(and(eq(posts.id, postId), eq(posts.orgId, ctx.orgId), inArray(posts.mediaStatus, ["none", "failed"])))
    .returning({ id: posts.id });
  if (!claimed.length) return set("skipped", "HAS_IMAGES");
  const failPost = (code: string) => db.update(posts).set({ mediaStatus: "failed", mediaError: code, updatedAt: new Date() }).where(eq(posts.id, postId));
  try {
    await renderPostImages(db, { llm: deps.llm, images: deps.images ?? null, storage: deps.storage, now: deps.now }, ctx, postId, "new");
    return set("done");
  } catch (e) {
    const code = imageFailureCode(e);
    if (code) {
      await failPost(code);
      return set("failed", code);
    }
    // Unexpected: the post can be claimed again, the item goes back to the queue and the job is retried once.
    await failPost("RETRY");
    await db.update(bulkItems).set({ status: "queued", error: "RETRY", updatedAt: new Date() }).where(eq(bulkItems.id, itemId));
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
    .select({ id: bulkRuns.id, status: bulkRuns.status, scope: bulkRuns.scope, steps: bulkRuns.steps, total: bulkRuns.total, createdAt: bulkRuns.createdAt, finishedAt: bulkRuns.finishedAt, brandName: brands.name })
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
