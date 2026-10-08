// Credits (TASK-038, ADR-071). Prices per action are data the super admin edits; an organization's monthly allowance is
// one of its plan limits (`creditsPerMonth`, none = not limited); packs (bought or granted) are valid 12 months and are
// used after the allowance, soonest-expiring first. Spending happens in `reserve` (llm/spend.ts) together with the €
// cap. Until billing exists (TASK-036) "Kupi kredite" files a request that a super admin grants after payment.
import { and, asc, desc, eq, gt, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { auditLog, CREDIT_ACTIONS, CREDIT_PACKS, creditPacks, creditPrices, creditRequests, organization, orgSettings, usageLedger, user, type CreditAction, type CreditPackKey } from "../db/schema";
import { monthlyCreditsUsed, monthStart } from "../llm/spend";
import type { Actor } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";

export const PACK_MONTHS = 12;
export const WARN_AT = 0.8;
export const PENDING_MAX = 3;

export class CreditError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "INVALID" | "NOT_FOUND" | "TOO_MANY") {
    super(code);
  }
}

const superadmin = (a: Actor) => { if (a.role !== "superadmin") throw new CreditError("FORBIDDEN"); };
const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; };
const audit = (db: Db, userId: string, orgId: string | null, action: string, target: string | null, meta: Record<string, unknown>) =>
  db.insert(auditLog).values({ id: crypto.randomUUID(), actorUserId: userId, orgId, action, target, meta });

/** The price list in a fixed order (missing rows count as 0). */
export async function listCreditPrices(db: Db): Promise<{ action: CreditAction; credits: number }[]> {
  const rows = await db.select().from(creditPrices);
  return CREDIT_ACTIONS.map((action) => ({ action, credits: rows.find((r) => r.action === action)?.credits ?? 0 }));
}

const pricesInput = z.partialRecord(z.enum(CREDIT_ACTIONS), z.number().int().min(0).max(10_000));

/** Super admin: new prices (only the given actions change); audited with before → after. */
export async function setCreditPrices(db: Db, actor: Actor, input: z.input<typeof pricesInput>) {
  superadmin(actor);
  const r = pricesInput.safeParse(input);
  if (!r.success) throw new CreditError("INVALID");
  const before = await listCreditPrices(db);
  const changes: Record<string, { from: number; to: number }> = {};
  await db.transaction(async (tx) => {
    for (const [action, credits] of Object.entries(r.data) as [CreditAction, number][]) {
      const from = before.find((b) => b.action === action)!.credits;
      if (from === credits) continue;
      changes[action] = { from, to: credits };
      await tx.insert(creditPrices).values({ action, credits, updatedBy: actor.userId, updatedAt: new Date() })
        .onConflictDoUpdate({ target: creditPrices.action, set: { credits, updatedBy: actor.userId, updatedAt: new Date() } });
    }
    if (Object.keys(changes).length) await audit(tx as unknown as Db, actor.userId, null, "credits.prices", null, changes);
  });
  return changes;
}

export type CreditStatus = {
  /** The month's allowance; null = credits are not limited for this organization. */
  allowance: number | null;
  usedThisMonth: number;
  monthlyLeft: number | null;
  packs: { id: string; credits: number; remaining: number; expiresAt: Date; source: "grant" | "purchase" }[];
  packsLeft: number;
  /** null when not limited. */
  available: number | null;
  /** Share of everything this month (allowance + packs) already used, 0..1; null when not limited. */
  used: number | null;
  level: "ok" | "warn" | "out";
};

/** Where an organization stands this month. */
export async function creditStatus(db: Db, orgId: string, now = new Date()): Promise<CreditStatus> {
  const [s] = await db.select({ limits: orgSettings.limits }).from(orgSettings).where(eq(orgSettings.orgId, orgId));
  const allowance = s?.limits?.creditsPerMonth ?? null;
  const monthly = await monthlyCreditsUsed(db, orgId, now);
  const [{ all }] = await db.select({ all: sql<number>`coalesce(sum(${usageLedger.credits}), 0)::int` }).from(usageLedger)
    .where(and(eq(usageLedger.orgId, orgId), gte(usageLedger.createdAt, monthStart(now))));
  const packs = await db.select({ id: creditPacks.id, credits: creditPacks.credits, remaining: creditPacks.remaining, expiresAt: creditPacks.expiresAt, source: creditPacks.source })
    .from(creditPacks).where(and(eq(creditPacks.orgId, orgId), gt(creditPacks.remaining, 0), gt(creditPacks.expiresAt, now))).orderBy(asc(creditPacks.expiresAt));
  const packsLeft = packs.reduce((n, p) => n + p.remaining, 0);
  if (allowance === null) return { allowance, usedThisMonth: all, monthlyLeft: null, packs, packsLeft, available: null, used: null, level: "ok" };
  const monthlyLeft = Math.max(0, allowance - monthly);
  const available = monthlyLeft + packsLeft;
  const total = allowance + all - monthly + packsLeft; // allowance + what packs held this month
  const used = total > 0 ? Math.min(1, all / total) : 1;
  return { allowance, usedThisMonth: all, monthlyLeft, packs, packsLeft, available, used, level: available <= 0 ? "out" : used >= WARN_AT ? "warn" : "ok" };
}

const grantInput = z.object({ credits: z.number().int().min(1).max(1_000_000), months: z.number().int().min(1).max(36).default(PACK_MONTHS), note: z.string().trim().max(200).default("") });

/** Super admin: a pack for an organization (a gift, a correction, or a paid pack). Audited. */
export async function grantCredits(db: Db, actor: Actor, orgId: string, input: z.input<typeof grantInput>, opts: { source?: "grant" | "purchase"; now?: Date } = {}) {
  superadmin(actor);
  const r = grantInput.safeParse(input);
  if (!r.success) throw new CreditError("INVALID");
  const [org] = await db.select({ id: organization.id }).from(organization).where(eq(organization.id, orgId));
  if (!org) throw new CreditError("NOT_FOUND");
  const now = opts.now ?? new Date();
  const id = crypto.randomUUID();
  await db.insert(creditPacks).values({ id, orgId, credits: r.data.credits, remaining: r.data.credits, expiresAt: addMonths(now, r.data.months), source: opts.source ?? "grant", note: r.data.note, createdBy: actor.userId, createdAt: now });
  await audit(db, actor.userId, orgId, "credits.grant", id, { credits: r.data.credits, months: r.data.months, source: opts.source ?? "grant", note: r.data.note });
  return id;
}

/** Super admin: every pack of an organization (also used up and expired), newest first. */
export async function listPacks(db: Db, actor: Actor, orgId: string) {
  superadmin(actor);
  return db.select().from(creditPacks).where(eq(creditPacks.orgId, orgId)).orderBy(desc(creditPacks.createdAt));
}

/** Owner: "Kupi kredite" — a request the super admin grants once paid (until checkout exists, TASK-036). */
export async function requestCredits(db: Db, ctx: OrgContext, pack: string) {
  if (ctx.role !== "owner") throw new CreditError("FORBIDDEN");
  if (!(pack in CREDIT_PACKS)) throw new CreditError("INVALID");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(creditRequests).where(and(eq(creditRequests.orgId, ctx.orgId), eq(creditRequests.status, "pending")));
  if (n >= PENDING_MAX) throw new CreditError("TOO_MANY");
  const id = crypto.randomUUID();
  await db.insert(creditRequests).values({ id, orgId: ctx.orgId, pack: pack as CreditPackKey, requestedBy: ctx.userId });
  await audit(db, ctx.userId, ctx.orgId, "credits.request", id, { pack });
  return id;
}

/** The organization's requests (owner's view), newest first. */
export async function orgCreditRequests(db: Db, ctx: OrgContext, limit = 10) {
  return db.select().from(creditRequests).where(eq(creditRequests.orgId, ctx.orgId)).orderBy(desc(creditRequests.createdAt)).limit(limit);
}

/** Super admin: open requests (all organizations, or one), with the organization and who asked. */
export async function pendingCreditRequests(db: Db, actor: Actor, orgId?: string) {
  superadmin(actor);
  return db.select({ id: creditRequests.id, orgId: creditRequests.orgId, orgName: organization.name, pack: creditRequests.pack, createdAt: creditRequests.createdAt, email: user.email })
    .from(creditRequests).innerJoin(organization, eq(organization.id, creditRequests.orgId)).leftJoin(user, eq(user.id, creditRequests.requestedBy))
    .where(and(eq(creditRequests.status, "pending"), ...(orgId ? [eq(creditRequests.orgId, orgId)] : []))).orderBy(asc(creditRequests.createdAt));
}

/** Super admin: grant (a paid pack of the requested size, 12 months) or decline. Claimed first, so it happens once. */
export async function resolveCreditRequest(db: Db, actor: Actor, id: string, decision: "grant" | "decline", now = new Date()) {
  superadmin(actor);
  const [r] = await db.update(creditRequests).set({ status: decision === "grant" ? "granted" : "declined", resolvedBy: actor.userId, resolvedAt: now })
    .where(and(eq(creditRequests.id, id), eq(creditRequests.status, "pending"))).returning();
  if (!r) throw new CreditError("NOT_FOUND");
  if (decision === "decline") {
    await audit(db, actor.userId, r.orgId, "credits.decline", id, { pack: r.pack });
    return;
  }
  const packId = await grantCredits(db, actor, r.orgId, { credits: CREDIT_PACKS[r.pack].credits, note: `${CREDIT_PACKS[r.pack].priceEur} €` }, { source: "purchase", now });
  await db.update(creditRequests).set({ packId }).where(eq(creditRequests.id, id));
}
