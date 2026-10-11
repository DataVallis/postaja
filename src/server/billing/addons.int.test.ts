// Plan features and add-ons (TASK-053, ADR-083): Solo makes posts and images only; Studio adds ads, animations and
// research; Agencija or the persona add-on adds the persona. Add-ons ride on the live subscription: the webhook reads
// them from the subscription's items and raises the limits; owners change them, Stripe prorates.
import { eq } from "drizzle-orm";
import postgres from "postgres";
import type Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { orgBilling, orgSettings } from "../db/schema";
import { createOrganization } from "../orgs/service";
import { createPersonaManual, postPersona } from "../personas/service";
import type { OrgContext } from "../tenancy/context";
import { createBrand } from "../brands/service";
import { addonFromLookupKey, catalogPrices, lookupKey, planFeatures, planFor } from "./catalog";
import { orgFeatures, PlanFeatureError, requireFeature } from "./features";
import { handleStripeEvent, setAddons } from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const NOW = new Date("2026-10-08T10:00:00Z");

let A: OrgContext, orgA: string;
beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, org_billing, stripe_events, brands cascade`;
  const s = (await session((await signIn("boss@datavallis.com"))!))!;
  orgA = (await createOrganization(db, { mailer, baseURL: "http://x" }, { userId: s.user.id, role: "superadmin" }, { name: "Agencija A", slug: "org-a", plan: "trial", ownerEmail: "boss@datavallis.com" })).orgId;
  A = { userId: s.user.id, orgId: orgA, orgName: "Agencija A", role: "owner", plan: "trial" };
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

let seq = 0;
const event = (type: string, object: unknown) => ({ id: `evt_a${++seq}`, type, data: { object } }) as unknown as Stripe.Event;
type Item = { id?: string; key: string; quantity?: number };
const subscription = (status: string, items: Item[]) => ({
  id: "sub_1", object: "subscription", customer: "cus_1", status, cancel_at_period_end: false, metadata: { orgId: orgA },
  items: { data: items.map((i, n) => ({ id: i.id ?? `si_${n}`, quantity: i.quantity ?? 1, price: { lookup_key: i.key }, current_period_end: Math.floor(NOW.getTime() / 1000) + 30 * 86_400 })) },
});
const settings = async () => (await db.select({ plan: orgSettings.plan, limits: orgSettings.limits }).from(orgSettings).where(eq(orgSettings.orgId, orgA)))[0];

/** Stripe stand-in for add-ons: a subscription with items, prices by lookup key, updates recorded. */
function fakeStripe(items: Item[]) {
  const updates: { id: string; args: Stripe.SubscriptionUpdateParams }[] = [];
  const stripe = {
    prices: { list: async (a: { lookup_keys: string[] }) => ({ data: a.lookup_keys.map((k) => ({ id: `price_${k}`, lookup_key: k })) }) },
    subscriptions: {
      retrieve: async () => subscription("active", items),
      update: async (id: string, args: Stripe.SubscriptionUpdateParams) => { updates.push({ id, args }); return {}; },
    },
  };
  return { stripe: stripe as unknown as Stripe, updates };
}

describe("plan features", () => {
  it("Solo: none of the extras; Studio, trial and pilot: ads, animation, research; Agencija or the add-on: persona; hand-managed plans: all", () => {
    expect([...planFeatures("solo")]).toEqual([]);
    expect([...planFeatures("studio")].sort()).toEqual(["ads", "animation", "research"]);
    expect([...planFeatures("trial")].sort()).toEqual(["ads", "animation", "research"]);
    expect(planFeatures("agency").has("persona")).toBe(true);
    expect([...planFeatures("solo", { persona: 1 })]).toEqual(["persona"]);
    expect(planFeatures("comped").size).toBe(4);
    expect([planFor("ads"), planFor("persona")]).toEqual(["studio", "agency"]);
  });

  it("add-on prices by lookup key, yearly = 10 months", () => {
    const byKey = new Map(catalogPrices().map((p) => [p.key, p.cents]));
    expect(byKey.get(lookupKey.addon("brand", "month"))).toBe(1_500);
    expect(byKey.get(lookupKey.addon("member", "year"))).toBe(9_000);
    expect(byKey.get(lookupKey.addon("persona", "month"))).toBe(4_900);
    expect(addonFromLookupKey("postaja_addon_persona_year")).toEqual({ addon: "persona", interval: "year" });
    expect(addonFromLookupKey("postaja_studio_month")).toBeNull();
  });

  it("the server refuses what the plan lacks; the persona add-on unlocks the persona; posts draw no persona without it", async () => {
    await db.update(orgSettings).set({ plan: "solo" }).where(eq(orgSettings.orgId, orgA));
    await expect(requireFeature(db, A, "ads")).rejects.toBeInstanceOf(PlanFeatureError);
    const brand = (await createBrand(db, A, { name: "Pekarna", slug: "pekarna", languages: ["sl"] })).id;
    const dna = { gender: "ženska", ageRange: "30-40", ethnicity: "srednjeevropska", hairColor: "rjavi" };
    await expect(createPersonaManual(db, A, brand, { name: "Ana", dna } as never)).rejects.toMatchObject({ code: "PLAN_FEATURE", feature: "persona" });
    expect(await postPersona(db, A, brand, true)).toBeNull();
    await db.insert(orgBilling).values({ orgId: orgA, addons: { persona: 1 } });
    expect((await orgFeatures(db, orgA)).has("persona")).toBe(true);
    await expect(requireFeature(db, A, "persona")).resolves.toBeUndefined();
    await expect(requireFeature(db, A, "research")).rejects.toMatchObject({ feature: "research" });
  });
});

describe("add-ons", () => {
  it("the webhook reads add-ons from the subscription's items and adds extra brands and members to the plan's limits", async () => {
    await db.insert(orgBilling).values({ orgId: orgA, stripeCustomerId: "cus_1" });
    await handleStripeEvent(db, event("customer.subscription.updated", subscription("active", [
      { key: "postaja_addon_brand_month", quantity: 3 }, { key: "postaja_solo_month" }, { key: "postaja_addon_member_month", quantity: 2 }, { key: "postaja_addon_persona_month" },
    ])), NOW);
    const b = (await db.select().from(orgBilling).where(eq(orgBilling.orgId, orgA)))[0];
    expect(b).toMatchObject({ plan: "solo", interval: "month", addons: { brand: 3, member: 2, persona: 1 } });
    const s = await settings();
    expect(s.plan).toBe("solo");
    expect(s.limits).toMatchObject({ brands: 2 + 3, members: 1 + 2 });
    expect([...(await orgFeatures(db, orgA))]).toEqual(["persona"]);
    // Removing the add-ons lowers the limits again.
    await handleStripeEvent(db, event("customer.subscription.updated", subscription("active", [{ key: "postaja_solo_month" }])), NOW);
    expect((await settings()).limits).toMatchObject({ brands: 2, members: 1 });
    expect((await orgFeatures(db, orgA)).size).toBe(0);
  });

  it("owners change quantities on the live subscription: update, remove, add at the subscription's interval; prorated", async () => {
    const f = fakeStripe([{ id: "si_plan", key: "postaja_studio_year" }, { id: "si_brand", key: "postaja_addon_brand_year", quantity: 2 }, { id: "si_member", key: "postaja_addon_member_year" }]);
    await expect(setAddons(db, f.stripe, A, { brand: 1 })).rejects.toMatchObject({ code: "NO_SUBSCRIPTION" });
    await db.insert(orgBilling).values({ orgId: orgA, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", status: "active", plan: "studio", interval: "year" });
    await expect(setAddons(db, f.stripe, { ...A, role: "editor" }, { brand: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setAddons(db, null, A, { brand: 1 })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(setAddons(db, f.stripe, A, { brand: 51 })).rejects.toMatchObject({ code: "ADDON_INVALID" });
    await expect(setAddons(db, f.stripe, A, { persona: 2 })).rejects.toMatchObject({ code: "ADDON_INVALID" });
    await setAddons(db, f.stripe, A, { brand: 5, member: 0, persona: 1 });
    expect(f.updates).toEqual([{ id: "sub_1", args: {
      items: [{ id: "si_brand", quantity: 5 }, { id: "si_member", deleted: true }, { price: "price_postaja_addon_persona_year", quantity: 1 }],
      proration_behavior: "create_prorations", metadata: { orgId: orgA },
    } }]);
    // Agencija already includes the persona.
    await db.update(orgBilling).set({ plan: "agency" }).where(eq(orgBilling.orgId, orgA));
    await expect(setAddons(db, f.stripe, A, { persona: 1 })).rejects.toMatchObject({ code: "ADDON_INVALID" });
  });
});
