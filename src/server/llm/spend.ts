// Monthly spend cap (ADR-015, ADR-036). Before a provider call we reserve the worst-case cost inside a transaction
// that locks the org's settings row; parallel calls therefore queue on the lock and see each other's reservations.
// After the call the reservation is settled to the real cost, or released if the call failed.
import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { orgSettings, usageLedger } from "../db/schema";

export class SpendCapError extends Error {
  constructor(public readonly usedMicroUsd: bigint, public readonly capMicroUsd: bigint) {
    super("SPEND_CAP");
  }
}

/**
 * The plan's monthly number of AI generations is used up (TASK-028, ADR-058). A generation is one paid AI call (one
 * ledger reservation). A SpendCapError, so every caller already treats it as "the monthly limit is reached".
 */
export class GenerationLimitError extends SpendCapError {
  constructor(public readonly used: number, public readonly limit: number) {
    super(0n, 0n);
    this.message = "GENERATION_LIMIT";
  }
}

/** Paid AI calls of the organization this month (reserved or settled). */
export async function generationsThisMonth(db: Db, orgId: string, now = new Date()): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(usageLedger).where(and(eq(usageLedger.orgId, orgId), gte(usageLedger.createdAt, monthStart(now))));
  return r.n;
}

/** Start of the current calendar month in UTC. */
export const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export async function monthToDate(db: Db, orgId: string, now = new Date()): Promise<bigint> {
  const [r] = await db
    .select({ s: sql<string>`coalesce(sum(${usageLedger.costMicroUsd}), 0)::text` })
    .from(usageLedger)
    .where(and(eq(usageLedger.orgId, orgId), gte(usageLedger.createdAt, monthStart(now))));
  return BigInt(r.s);
}

/** Reserves `estimate` or throws SpendCapError when used + estimate would exceed the cap (equal is allowed). */
export async function reserve(
  db: Db,
  a: { orgId: string; brandId: string | null; postId: string | null; provider: string; model: string; estimate: bigint; now?: Date },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    const [s] = await tx.select({ cap: orgSettings.spendCapMicroUsd, limits: orgSettings.limits }).from(orgSettings).where(eq(orgSettings.orgId, a.orgId)).for("update");
    if (!s) throw new Error("ORG_NOT_FOUND");
    const max = s.limits?.generationsPerMonth;
    if (max !== undefined) {
      const n = await generationsThisMonth(tx as unknown as Db, a.orgId, a.now);
      if (n >= max) throw new GenerationLimitError(n, max);
    }
    const used = await monthToDate(tx as unknown as Db, a.orgId, a.now);
    if (used + a.estimate > s.cap) throw new SpendCapError(used, s.cap);
    await tx.insert(usageLedger).values({
      id, orgId: a.orgId, brandId: a.brandId, postId: a.postId, provider: a.provider, model: a.model, state: "reserved", costMicroUsd: a.estimate,
      ...(a.now ? { createdAt: a.now } : {}),
    });
  });
  return id;
}

export async function settle(db: Db, id: string, usage: { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number }, cost: bigint) {
  await db.update(usageLedger).set({ state: "settled", ...usage, costMicroUsd: cost }).where(eq(usageLedger.id, id));
}

/** The call failed before any usage: nothing was spent. */
export async function release(db: Db, id: string) {
  await db.delete(usageLedger).where(and(eq(usageLedger.id, id), eq(usageLedger.state, "reserved")));
}
