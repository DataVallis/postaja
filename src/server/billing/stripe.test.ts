// Stripe catalogue sync (TASK-036, ADR-080): missing prices are created; a price whose amount changed is replaced
// (lookup key moved to the new price, the old one archived); unchanged prices are left alone.
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { catalogPrices, lookupKey, PLAN_CATALOG } from "./catalog";
import { ensureStripeCatalog } from "./stripe";

type P = { id: string; product: string; unit_amount: number; lookup_key: string | null; active: boolean };

function fakeStripe(initial: { key: string; cents: number }[]) {
  const prices: P[] = initial.map((p, i) => ({ id: `price_old_${i}`, product: `prod_${p.key}`, unit_amount: p.cents, lookup_key: p.key, active: true }));
  const calls: string[] = [];
  let n = 0;
  const stripe = {
    prices: {
      async list(q: { lookup_keys: string[]; active?: boolean }) {
        return { data: prices.filter((p) => p.lookup_key && q.lookup_keys.includes(p.lookup_key) && (q.active === undefined || p.active)).map((p) => ({ ...p, product: { id: p.product, tax_code: "txcd" } })) };
      },
      async retrieve(id: string) { return prices.find((p) => p.id === id)!; },
      async create(b: { product: string; unit_amount: number; lookup_key: string; transfer_lookup_key?: boolean }) {
        calls.push(`create ${b.lookup_key} ${b.unit_amount}${b.transfer_lookup_key ? " transfer" : ""}`);
        if (b.transfer_lookup_key) for (const p of prices) if (p.lookup_key === b.lookup_key) p.lookup_key = null;
        const p = { id: `price_new_${n++}`, product: b.product, unit_amount: b.unit_amount, lookup_key: b.lookup_key, active: true };
        prices.push(p);
        return p;
      },
      async update(id: string, b: { active: boolean }) { calls.push(`archive ${id}`); prices.find((p) => p.id === id)!.active = b.active; return {}; },
    },
    products: {
      async create(b: { name: string }) { calls.push(`product ${b.name}`); return { id: `prod_${n++}` }; },
      async update() { return {}; },
    },
  };
  return { stripe: stripe as unknown as Stripe, prices, calls };
}

describe("ensureStripeCatalog", () => {
  it("new prices: Studio 149 €, Agencija 499 € (yearly = 10 months); Solo stays 39 €", () => {
    expect([PLAN_CATALOG.solo.priceEur, PLAN_CATALOG.studio.priceEur, PLAN_CATALOG.agency.priceEur]).toEqual([39, 149, 499]);
    const byKey = new Map(catalogPrices().map((p) => [p.key, p.cents]));
    expect(byKey.get(lookupKey.plan("studio", "year"))).toBe(149_000);
    expect(byKey.get(lookupKey.plan("agency", "month"))).toBe(49_900);
  });

  it("replaces only the prices whose amount changed and keeps the rest", async () => {
    const want = catalogPrices();
    const old = want.map((w) => ({ key: w.key, cents: w.key === lookupKey.plan("studio", "month") ? 9_900 : w.key === lookupKey.plan("agency", "year") ? 249_000 : w.cents }));
    const f = fakeStripe(old);
    const r = await ensureStripeCatalog(f.stripe);
    expect(r.created).toEqual([]);
    expect(r.updated.sort()).toEqual([lookupKey.plan("agency", "year"), lookupKey.plan("studio", "month")].sort());
    expect(f.calls).toEqual(expect.arrayContaining([`create ${lookupKey.plan("studio", "month")} 14900 transfer`, `create ${lookupKey.plan("agency", "year")} 499000 transfer`]));
    expect(f.calls.filter((c) => c.startsWith("archive"))).toHaveLength(2);
    // Every lookup key now points to exactly one active price with the catalogue amount.
    for (const w of want) {
      const live = f.prices.filter((p) => p.lookup_key === w.key && p.active);
      expect(live.map((p) => p.unit_amount), w.key).toEqual([w.cents]);
    }
    // Running it again changes nothing.
    f.calls.length = 0;
    expect(await ensureStripeCatalog(f.stripe)).toMatchObject({ created: [], updated: [] });
    expect(f.calls).toEqual([]);
  });

  it("creates what is missing", async () => {
    const f = fakeStripe([]);
    const r = await ensureStripeCatalog(f.stripe);
    expect(r.created).toHaveLength(catalogPrices().length);
    expect(r.updated).toEqual([]);
  });
});
