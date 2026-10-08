// Billing with Stripe (TASK-036, ADR-073). Owners pick a plan (monthly or yearly), the agency pilot or a credit pack;
// Stripe Checkout takes the payment (VAT with Stripe Tax when on, VAT ids collected) and issues the invoice; the
// customer portal handles cards, invoices, plan changes and cancelling. Webhooks are the only source of truth: each
// event is processed once, and the subscription's plan sets the organization's plan and limits (brands, members,
// monthly credits). An unpaid subscription keeps working for GRACE_DAYS, then — like a cancelled one or an ended
// pilot — new AI work stops (`billingBlock`, checked in `reserve`); everything made stays readable and downloadable.
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import type { Db } from "../db/client";
import { orgBilling, orgSettings, stripeEvents, user, type SubscriptionStatus } from "../db/schema";
import { insertPack } from "../credits/service";
import type { OrgContext } from "../tenancy/context";
import { CREDIT_PACK_PRICES, lookupKey, PAID_PLANS, PILOT, PLAN_CATALOG, planFromLookupKey, type Interval, type PaidPlan } from "./catalog";
import { automaticTax, pricesByLookupKey } from "./stripe";

export class BillingError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "NOT_CONFIGURED" | "INVALID" | "HAS_SUBSCRIPTION" | "PILOT_USED" | "NO_CUSTOMER" | "NO_PRICE") {
    super(code);
  }
}

export type BillingRow = typeof orgBilling.$inferSelect;
export type CheckoutItem = { kind: "plan"; plan: PaidPlan; interval: Interval } | { kind: "pilot" } | { kind: "pack"; pack: keyof typeof CREDIT_PACK_PRICES };

const LIVE: SubscriptionStatus[] = ["active", "trialing", "past_due"];
const DAY = 86_400_000;
export { billingBlock } from "./block";

export async function billingFor(db: Db, orgId: string): Promise<BillingRow | null> {
  const [r] = await db.select().from(orgBilling).where(eq(orgBilling.orgId, orgId));
  return r ?? null;
}

/** The org's Stripe customer (made once, named after the org, the owner's email). */
async function customerFor(db: Db, stripe: Stripe, ctx: OrgContext): Promise<string> {
  const b = await billingFor(db, ctx.orgId);
  if (b?.stripeCustomerId) return b.stripeCustomerId;
  const [me] = await db.select({ email: user.email }).from(user).where(eq(user.id, ctx.userId));
  const c = await stripe.customers.create({ name: ctx.orgName, email: me?.email, metadata: { orgId: ctx.orgId } }, { idempotencyKey: `customer:${ctx.orgId}` });
  await db.insert(orgBilling).values({ orgId: ctx.orgId, stripeCustomerId: c.id }).onConflictDoUpdate({ target: orgBilling.orgId, set: { stripeCustomerId: c.id, updatedAt: new Date() } });
  return c.id;
}

/** Owner: a Stripe Checkout page for a plan, the pilot or a credit pack. Returns its URL. */
export async function checkoutUrl(db: Db, stripe: Stripe | null, ctx: OrgContext, item: CheckoutItem, appUrl: string): Promise<string> {
  if (ctx.role !== "owner") throw new BillingError("FORBIDDEN");
  if (!stripe) throw new BillingError("NOT_CONFIGURED");
  const b = await billingFor(db, ctx.orgId);
  if (item.kind === "plan") {
    if (!PAID_PLANS.includes(item.plan) || (item.interval !== "month" && item.interval !== "year")) throw new BillingError("INVALID");
    if (b && LIVE.includes(b.status) && b.stripeSubscriptionId) throw new BillingError("HAS_SUBSCRIPTION"); // changes go through the portal
  }
  if (item.kind === "pilot" && (b?.pilotEndsAt || (b && b.status !== "none"))) throw new BillingError("PILOT_USED");
  if (item.kind === "pack" && !(item.pack in CREDIT_PACK_PRICES)) throw new BillingError("INVALID");
  const key = item.kind === "plan" ? lookupKey.plan(item.plan, item.interval) : item.kind === "pilot" ? lookupKey.pilot : lookupKey.pack(item.pack);
  const price = (await pricesByLookupKey(stripe, [key])).get(key);
  if (!price) throw new BillingError("NO_PRICE");
  const customer = await customerFor(db, stripe, ctx);
  const metadata = { orgId: ctx.orgId, kind: item.kind, ...(item.kind === "plan" ? { plan: item.plan } : {}), ...(item.kind === "pack" ? { pack: item.pack } : {}) };
  const session = await stripe.checkout.sessions.create({
    mode: item.kind === "plan" ? "subscription" : "payment",
    customer,
    client_reference_id: ctx.orgId,
    line_items: [{ price, quantity: 1 }],
    metadata,
    ...(item.kind === "plan" ? { subscription_data: { metadata } } : { invoice_creation: { enabled: true, invoice_data: { metadata } }, payment_intent_data: { metadata } }),
    automatic_tax: { enabled: automaticTax() },
    tax_id_collection: { enabled: true },
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
    allow_promotion_codes: true,
    locale: "auto",
    success_url: `${appUrl}/app/team?billing=success`,
    cancel_url: `${appUrl}/app/team?billing=cancel`,
  });
  if (!session.url) throw new BillingError("NOT_CONFIGURED");
  return session.url;
}

/** Owner: Stripe's customer portal (card, invoices, plan change, cancel). */
export async function portalUrl(db: Db, stripe: Stripe | null, ctx: OrgContext, appUrl: string): Promise<string> {
  if (ctx.role !== "owner") throw new BillingError("FORBIDDEN");
  if (!stripe) throw new BillingError("NOT_CONFIGURED");
  const b = await billingFor(db, ctx.orgId);
  if (!b?.stripeCustomerId) throw new BillingError("NO_CUSTOMER");
  const s = await stripe.billingPortal.sessions.create({ customer: b.stripeCustomerId, return_url: `${appUrl}/app/team` });
  return s.url;
}

// ---- Webhooks ------------------------------------------------------------------------------------------------------

/** The plan's limits on the organization (super-admin overrides of these three are replaced; others stay). */
async function applyPlan(db: Db, orgId: string, plan: PaidPlan | "pilot") {
  const limits = plan === "pilot" ? PILOT.limits : PLAN_CATALOG[plan].limits;
  const [s] = await db.select({ limits: orgSettings.limits }).from(orgSettings).where(eq(orgSettings.orgId, orgId));
  await db.update(orgSettings).set({ plan, limits: { ...(s?.limits ?? {}), ...limits }, updatedAt: new Date() }).where(eq(orgSettings.orgId, orgId));
}

async function orgOfCustomer(db: Db, customer: string | null | undefined): Promise<string | null> {
  if (!customer) return null;
  const [r] = await db.select({ orgId: orgBilling.orgId }).from(orgBilling).where(eq(orgBilling.stripeCustomerId, customer));
  return r?.orgId ?? null;
}

async function orgExists(db: Db, orgId: string | undefined): Promise<string | null> {
  if (!orgId) return null;
  const [r] = await db.select({ id: orgSettings.orgId }).from(orgSettings).where(eq(orgSettings.orgId, orgId));
  return r?.id ?? null;
}

const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id ?? null);

/** Subscription created / updated / deleted → the org's billing row and, while it is live, its plan and limits. */
async function onSubscription(db: Db, sub: Stripe.Subscription, now: Date): Promise<{ orgId: string | null; outcome: string }> {
  const customer = idOf(sub.customer);
  const orgId = (await orgOfCustomer(db, customer)) ?? (await orgExists(db, sub.metadata?.orgId));
  if (!orgId) return { orgId: null, outcome: "unknown-org" };
  const item = sub.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
  const found = planFromLookupKey(item?.price?.lookup_key);
  const periodEnd = item?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  const status = sub.status as SubscriptionStatus;
  const before = await billingFor(db, orgId);
  const row = {
    stripeCustomerId: customer, stripeSubscriptionId: sub.id, status, plan: found?.plan ?? before?.plan ?? null, interval: found?.interval ?? null,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null, cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    pastDueSince: status === "past_due" ? (before?.pastDueSince ?? now) : null, updatedAt: now,
  };
  await db.insert(orgBilling).values({ orgId, ...row }).onConflictDoUpdate({ target: orgBilling.orgId, set: row });
  if ((status === "active" || status === "trialing") && found) {
    await applyPlan(db, orgId, found.plan);
    // A paid plan ends the pilot.
    if (before?.pilotEndsAt && before.pilotEndsAt > now) await db.update(orgBilling).set({ pilotEndsAt: now }).where(eq(orgBilling.orgId, orgId));
  }
  return { orgId, outcome: `subscription:${status}:${found?.plan ?? "?"}` };
}

/** A paid one-time checkout: the pilot (30 days of Studio with 3 brands) or a credit pack (12 months). */
async function onCheckout(db: Db, s: Stripe.Checkout.Session, now: Date): Promise<{ orgId: string | null; outcome: string }> {
  const orgId = (await orgExists(db, s.metadata?.orgId ?? s.client_reference_id ?? undefined)) ?? (await orgOfCustomer(db, idOf(s.customer)));
  if (!orgId) return { orgId: null, outcome: "unknown-org" };
  const customer = idOf(s.customer);
  if (customer) await db.insert(orgBilling).values({ orgId, stripeCustomerId: customer }).onConflictDoNothing();
  if (s.mode === "subscription") return { orgId, outcome: "checkout:subscription" }; // the subscription events carry the state
  if (s.payment_status !== "paid") return { orgId, outcome: `checkout:${s.payment_status}` };
  if (s.metadata?.kind === "pilot") {
    await db.update(orgBilling).set({ plan: "pilot", pilotEndsAt: new Date(now.getTime() + PILOT.days * DAY), updatedAt: now }).where(eq(orgBilling.orgId, orgId));
    await applyPlan(db, orgId, "pilot");
    return { orgId, outcome: "pilot" };
  }
  const pack = s.metadata?.pack as keyof typeof CREDIT_PACK_PRICES | undefined;
  if (s.metadata?.kind === "pack" && pack && pack in CREDIT_PACK_PRICES) {
    await insertPack(db, { orgId, credits: CREDIT_PACK_PRICES[pack].credits, source: "purchase", note: `Stripe ${s.id}`, createdBy: null, now });
    return { orgId, outcome: `pack:${CREDIT_PACK_PRICES[pack].credits}` };
  }
  return { orgId, outcome: "checkout:ignored" };
}

/**
 * One verified webhook event. Processed once (a repeated id is skipped); unknown types are recorded as ignored.
 * Throws only on unexpected errors, so Stripe retries.
 */
export async function handleStripeEvent(db: Db, event: Stripe.Event, now = new Date()): Promise<"processed" | "duplicate"> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const fresh = await tx.insert(stripeEvents).values({ id: event.id, type: event.type }).onConflictDoNothing().returning({ id: stripeEvents.id });
    if (!fresh.length) return "duplicate" as const;
    let r: { orgId: string | null; outcome: string } = { orgId: null, outcome: "ignored" };
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") r = await onCheckout(t, event.data.object as Stripe.Checkout.Session, now);
    else if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      r = await onSubscription(t, event.data.object as Stripe.Subscription, now);
    }
    await tx.update(stripeEvents).set({ orgId: r.orgId, outcome: r.outcome }).where(eq(stripeEvents.id, event.id));
    return "processed" as const;
  });
}
