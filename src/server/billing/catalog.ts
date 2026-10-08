// What Postaja sells (business plan §4, owner 2026-10-08; prices without VAT). Stripe prices are found by lookup key,
// so the code never needs price ids; `ensureStripeCatalog` creates the missing ones.
import { CREDIT_PACKS } from "../db/schema";
import type { OrgLimits } from "../orgs/service";

export const PAID_PLANS = ["solo", "studio", "agency"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];
export type Interval = "month" | "year";

export const PLAN_CATALOG: Record<PaidPlan, { name: string; priceEur: number; limits: Required<Pick<OrgLimits, "brands" | "members" | "creditsPerMonth">> }> = {
  solo: { name: "Solo", priceEur: 39, limits: { brands: 2, members: 1, creditsPerMonth: 400 } },
  studio: { name: "Studio", priceEur: 99, limits: { brands: 6, members: 3, creditsPerMonth: 1500 } },
  agency: { name: "Agencija", priceEur: 249, limits: { brands: 20, members: 10, creditsPerMonth: 5000 } },
};
/** Yearly = 10 × the monthly price (two months free). */
export const YEAR_MONTHS = 10;

/** Agency pilot: 99 € once, 30 days of Studio with 3 brands. */
export const PILOT = { name: "Agencijski pilot", priceEur: 99, days: 30, limits: { brands: 3, members: 3, creditsPerMonth: 1500 } } as const;

export const CREDIT_PACK_PRICES = CREDIT_PACKS;

/** Unpaid renewals: new AI work stops this long after the first failed payment (the card can be fixed meanwhile). */
export const GRACE_DAYS = 7;

export const lookupKey = {
  plan: (plan: PaidPlan, interval: Interval) => `postaja_${plan}_${interval}`,
  pilot: "postaja_pilot",
  pack: (pack: keyof typeof CREDIT_PACK_PRICES) => `postaja_credits_${CREDIT_PACK_PRICES[pack].credits}`,
};

/** Every price Postaja needs in Stripe: lookup key, product name, amount in cents, recurring interval or one-time. */
export function catalogPrices(): { key: string; product: string; cents: number; interval: Interval | null }[] {
  return [
    ...PAID_PLANS.flatMap((p) => [
      { key: lookupKey.plan(p, "month"), product: `Postaja ${PLAN_CATALOG[p].name}`, cents: PLAN_CATALOG[p].priceEur * 100, interval: "month" as const },
      { key: lookupKey.plan(p, "year"), product: `Postaja ${PLAN_CATALOG[p].name}`, cents: PLAN_CATALOG[p].priceEur * 100 * YEAR_MONTHS, interval: "year" as const },
    ]),
    { key: lookupKey.pilot, product: `Postaja ${PILOT.name}`, cents: PILOT.priceEur * 100, interval: null },
    ...(Object.keys(CREDIT_PACK_PRICES) as (keyof typeof CREDIT_PACK_PRICES)[]).map((k) => ({
      key: lookupKey.pack(k), product: `Postaja ${CREDIT_PACK_PRICES[k].credits} kreditov`, cents: CREDIT_PACK_PRICES[k].priceEur * 100, interval: null,
    })),
  ];
}

/** solo / studio / agency and the interval from a lookup key, or null. */
export function planFromLookupKey(key: string | null | undefined): { plan: PaidPlan; interval: Interval } | null {
  const m = /^postaja_(solo|studio|agency)_(month|year)$/.exec(key ?? "");
  return m ? { plan: m[1] as PaidPlan, interval: m[2] as Interval } : null;
}
