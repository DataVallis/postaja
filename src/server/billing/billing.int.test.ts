// Billing with Stripe (TASK-036, ADR-073): checkout for plans, the pilot and credit packs (owners only, one subscription,
// one pilot); webhooks processed once; a live subscription sets the plan and its limits; past_due keeps working for
// the grace period, then — like a cancelled plan or an ended pilot — new AI work stops; packs bought are added.
import { eq } from "drizzle-orm";
import postgres from "postgres";
import type Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { creditPacks, orgBilling, orgSettings, stripeEvents } from "../db/schema";
import { BillingBlockedError, reserve } from "../llm/spend";
import { createOrganization, inviteMember } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { billingBlock } from "./block";
import { BillingError, checkoutUrl, handleStripeEvent, portalUrl } from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const NOW = new Date("2026-10-08T10:00:00Z");
const DAY = 86_400_000;

let A: OrgContext, editorA: OrgContext, orgA: string;
beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, usage_ledger, credit_packs, org_billing, stripe_events cascade`;
  const s = (await session((await signIn("boss@datavallis.com"))!))!;
  const boss = { userId: s.user.id, role: "superadmin" as const };
  const d = { mailer, baseURL: "http://localhost:3000" };
  orgA = (await createOrganization(db, d, boss, { name: "Agencija A", slug: "org-a", plan: "trial", ownerEmail: "boss@datavallis.com" })).orgId;
  await inviteMember(db, d, boss, orgA, { email: "ed@a.si", role: "editor" });
  const ed = (await session((await signIn("ed@a.si"))!))!.user;
  A = { userId: s.user.id, orgId: orgA, orgName: "Agencija A", role: "owner", plan: "trial" };
  editorA = { ...A, userId: ed.id, role: "editor" };
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

/** A stand-in for the Stripe client: records requests, knows the catalogue's lookup keys. */
function fakeStripe(prices: string[] = ["postaja_studio_month", "postaja_studio_year", "postaja_pilot", "postaja_credits_500"]) {
  const calls: { what: string; args: unknown }[] = [];
  let n = 0;
  const stripe = {
    prices: { list: async (args: { lookup_keys: string[] }) => ({ data: args.lookup_keys.filter((k) => prices.includes(k)).map((k) => ({ id: `price_${k}`, lookup_key: k })) }) },
    customers: { create: async (args: unknown) => { calls.push({ what: "customer", args }); return { id: `cus_${++n}` }; } },
    checkout: { sessions: { create: async (args: unknown) => { calls.push({ what: "checkout", args }); return { id: `cs_${++n}`, url: `https://checkout.stripe.test/${n}` }; } } },
    billingPortal: { sessions: { create: async (args: unknown) => { calls.push({ what: "portal", args }); return { url: "https://billing.stripe.test/p" }; } } },
  };
  return { stripe: stripe as unknown as Stripe, calls };
}

let seq = 0;
const event = (type: string, object: unknown) => ({ id: `evt_${++seq}`, type, data: { object } }) as unknown as Stripe.Event;
const subscription = (o: { status: string; key?: string; customer?: string; cancel?: boolean; end?: number }) => ({
  id: "sub_1", object: "subscription", customer: o.customer ?? "cus_1", status: o.status, cancel_at_period_end: !!o.cancel, metadata: { orgId: orgA },
  items: { data: [{ price: { lookup_key: o.key ?? "postaja_studio_month" }, current_period_end: o.end ?? Math.floor((NOW.getTime() + 30 * DAY) / 1000) }] },
});
const settings = async () => (await db.select({ plan: orgSettings.plan, limits: orgSettings.limits }).from(orgSettings).where(eq(orgSettings.orgId, orgA)))[0];
const billing = async () => (await db.select().from(orgBilling).where(eq(orgBilling.orgId, orgA)))[0];
const spend = (now = NOW) => reserve(db, { orgId: orgA, brandId: null, postId: null, provider: "x", model: "m", estimate: 1n, action: "assist", now });

describe("checkout", () => {
  it("owners only; one customer per org; the price by lookup key; plan changes go through the portal", async () => {
    const f = fakeStripe();
    await expect(checkoutUrl(db, f.stripe, editorA, { kind: "plan", plan: "studio", interval: "month" }, "https://app")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(checkoutUrl(db, null, A, { kind: "plan", plan: "studio", interval: "month" }, "https://app")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(checkoutUrl(db, f.stripe, A, { kind: "plan", plan: "agency", interval: "month" }, "https://app")).rejects.toMatchObject({ code: "NO_PRICE" });
    await expect(checkoutUrl(db, f.stripe, A, { kind: "plan", plan: "gold" as "solo", interval: "month" }, "https://app")).rejects.toMatchObject({ code: "INVALID" });
    expect(await checkoutUrl(db, f.stripe, A, { kind: "plan", plan: "studio", interval: "year" }, "https://app")).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    await checkoutUrl(db, f.stripe, A, { kind: "pack", pack: "small" }, "https://app");
    expect(f.calls.filter((c) => c.what === "customer")).toHaveLength(1);
    const [sub, pack] = f.calls.filter((c) => c.what === "checkout").map((c) => c.args as Record<string, unknown>);
    expect(sub).toMatchObject({
      mode: "subscription", customer: "cus_1", client_reference_id: orgA, line_items: [{ price: "price_postaja_studio_year", quantity: 1 }],
      metadata: { orgId: orgA, kind: "plan", plan: "studio" }, subscription_data: { metadata: { orgId: orgA, kind: "plan", plan: "studio" } },
      tax_id_collection: { enabled: true }, billing_address_collection: "required", success_url: "https://app/app/team?billing=success",
    });
    expect(pack).toMatchObject({ mode: "payment", metadata: { kind: "pack", pack: "small" }, invoice_creation: { enabled: true } });
    expect((await billing()).stripeCustomerId).toBe("cus_1");
    expect(await portalUrl(db, f.stripe, A, "https://app")).toBe("https://billing.stripe.test/p");
    await expect(portalUrl(db, f.stripe, editorA, "https://app")).rejects.toBeInstanceOf(BillingError);

    await handleStripeEvent(db, event("customer.subscription.created", subscription({ status: "active" })), NOW);
    await expect(checkoutUrl(db, f.stripe, A, { kind: "plan", plan: "studio", interval: "month" }, "https://app")).rejects.toMatchObject({ code: "HAS_SUBSCRIPTION" });
    await expect(checkoutUrl(db, f.stripe, A, { kind: "pilot" }, "https://app")).rejects.toMatchObject({ code: "PILOT_USED" });
  });
});

describe("webhooks", () => {
  it("a live subscription sets plan and limits (keeping other limits); each event once; cancelled → work stops", async () => {
    await db.update(orgSettings).set({ limits: { generationsPerMonth: 999, brands: 1 } }).where(eq(orgSettings.orgId, orgA));
    await db.insert(orgBilling).values({ orgId: orgA, stripeCustomerId: "cus_1" });
    const e = event("customer.subscription.created", subscription({ status: "active", key: "postaja_agency_year", cancel: true }));
    expect(await handleStripeEvent(db, e, NOW)).toBe("processed");
    expect(await handleStripeEvent(db, e, NOW)).toBe("duplicate");
    expect(await settings()).toEqual({ plan: "agency", limits: { generationsPerMonth: 999, brands: 20, members: 10, creditsPerMonth: 5000 } });
    expect(await billing()).toMatchObject({ status: "active", plan: "agency", interval: "year", stripeSubscriptionId: "sub_1", cancelAtPeriodEnd: true });
    expect((await billing()).currentPeriodEnd!.toISOString()).toBe("2026-11-07T10:00:00.000Z");
    expect((await db.select().from(stripeEvents)).map((x) => [x.type, x.orgId, x.outcome])).toEqual([["customer.subscription.created", orgA, "subscription:active:agency"]]);
    await spend();
    await handleStripeEvent(db, event("customer.subscription.deleted", subscription({ status: "canceled", key: "postaja_agency_year" })), NOW);
    await expect(spend()).rejects.toBeInstanceOf(BillingBlockedError);
    expect((await settings()).plan).toBe("agency"); // what was made stays; only new AI work stops
    await handleStripeEvent(db, event("invoice.created", { id: "in_1" }), NOW);
    expect((await db.select().from(stripeEvents)).find((x) => x.type === "invoice.created")?.outcome).toBe("ignored");
  });

  it("past_due works for the grace period, then stops; paying again resumes", async () => {
    await db.insert(orgBilling).values({ orgId: orgA, stripeCustomerId: "cus_1" });
    await handleStripeEvent(db, event("customer.subscription.updated", subscription({ status: "past_due" })), NOW);
    await handleStripeEvent(db, event("customer.subscription.updated", subscription({ status: "past_due" })), new Date(NOW.getTime() + 3 * DAY));
    expect((await billing()).pastDueSince).toEqual(NOW); // the first failure counts
    await spend(new Date(NOW.getTime() + 6 * DAY));
    await expect(spend(new Date(NOW.getTime() + 8 * DAY))).rejects.toMatchObject({ reason: "PAST_DUE" });
    await handleStripeEvent(db, event("customer.subscription.updated", subscription({ status: "active" })), new Date(NOW.getTime() + 8 * DAY));
    expect((await billing()).pastDueSince).toBeNull();
    await spend(new Date(NOW.getTime() + 8 * DAY));
  });

  it("the pilot: 30 days of Studio with 3 brands, once; afterwards work stops until a plan is bought", async () => {
    const f = fakeStripe();
    await checkoutUrl(db, f.stripe, A, { kind: "pilot" }, "https://app");
    await handleStripeEvent(db, event("checkout.session.completed", { id: "cs_9", mode: "payment", payment_status: "paid", customer: "cus_1", client_reference_id: orgA, metadata: { orgId: orgA, kind: "pilot" } }), NOW);
    expect(await settings()).toMatchObject({ plan: "pilot", limits: { brands: 3, members: 3, creditsPerMonth: 1500 } });
    expect((await billing()).pilotEndsAt!.toISOString()).toBe("2026-11-07T10:00:00.000Z");
    await expect(checkoutUrl(db, f.stripe, A, { kind: "pilot" }, "https://app")).rejects.toMatchObject({ code: "PILOT_USED" });
    await spend(new Date(NOW.getTime() + 29 * DAY));
    await expect(spend(new Date(NOW.getTime() + 31 * DAY))).rejects.toMatchObject({ reason: "ENDED" });
    await handleStripeEvent(db, event("customer.subscription.created", subscription({ status: "active", key: "postaja_studio_month" })), new Date(NOW.getTime() + 31 * DAY));
    expect((await settings()).plan).toBe("studio");
    await spend(new Date(NOW.getTime() + 31 * DAY));
  });

  it("a paid pack adds 500 credits for 12 months; unpaid or unknown orgs change nothing", async () => {
    const paid = { id: "cs_1", mode: "payment", payment_status: "paid", customer: "cus_7", client_reference_id: orgA, metadata: { orgId: orgA, kind: "pack", pack: "small" } };
    await handleStripeEvent(db, event("checkout.session.completed", paid), NOW);
    await handleStripeEvent(db, event("checkout.session.completed", { ...paid, id: "cs_2", payment_status: "unpaid" }), NOW);
    await handleStripeEvent(db, event("checkout.session.completed", { ...paid, id: "cs_3", client_reference_id: "nope", metadata: { orgId: "nope", kind: "pack", pack: "small" }, customer: "cus_x" }), NOW);
    const packs = await db.select().from(creditPacks).where(eq(creditPacks.orgId, orgA));
    expect(packs.map((p) => [p.credits, p.source, p.note])).toEqual([[500, "purchase", "Stripe cs_1"]]);
    expect(packs[0].expiresAt.toISOString()).toBe("2027-10-08T10:00:00.000Z");
    expect((await billing()).stripeCustomerId).toBe("cus_7");
    await spend(); // a customer who only bought credits is not stopped
    expect((await db.select().from(stripeEvents)).map((x) => x.outcome).sort()).toEqual(["checkout:unpaid", "pack:500", "unknown-org"]);
  });
});

describe("billingBlock", () => {
  it("no row, active, trialing, early past_due, running pilot, only a customer → fine; the rest stops", () => {
    const at = (status: string, extra: Partial<{ pastDueSince: Date; pilotEndsAt: Date }> = {}) =>
      billingBlock({ status: status as "active", pastDueSince: extra.pastDueSince ?? null, pilotEndsAt: extra.pilotEndsAt ?? null }, NOW);
    expect([null, "active", "trialing", "none", "incomplete"].map((s) => (s ? at(s) : billingBlock(null, NOW)))).toEqual([null, null, null, null, null]);
    expect(at("past_due", { pastDueSince: new Date(NOW.getTime() - 2 * DAY) })).toBeNull();
    expect(at("past_due", { pastDueSince: new Date(NOW.getTime() - 8 * DAY) })).toBe("PAST_DUE");
    expect(["canceled", "unpaid", "paused"].map((s) => at(s))).toEqual(["ENDED", "ENDED", "ENDED"]);
    expect(at("none", { pilotEndsAt: new Date(NOW.getTime() + DAY) })).toBeNull();
    expect(at("canceled", { pilotEndsAt: new Date(NOW.getTime() + DAY) })).toBeNull();
    expect(at("none", { pilotEndsAt: new Date(NOW.getTime() - DAY) })).toBe("ENDED");
  });
});
