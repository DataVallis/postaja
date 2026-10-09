// The Stripe client (TASK-036). Configured only when STRIPE_SECRET_KEY is set; STRIPE_API_BASE points tests at a
// stand-in (production code has no other test switch). The webhook secret is STRIPE_WEBHOOK_SECRET.
import Stripe from "stripe";
import { catalogPrices } from "./catalog";

let cached: Stripe | null | undefined;

export function getStripe(env: NodeJS.ProcessEnv = process.env): Stripe | null {
  if (cached !== undefined && env === process.env) return cached;
  const key = env.STRIPE_SECRET_KEY?.trim();
  let client: Stripe | null = null;
  if (key) {
    const base = env.STRIPE_API_BASE ? new URL(env.STRIPE_API_BASE) : null;
    client = new Stripe(key, {
      maxNetworkRetries: 2,
      timeout: 20_000,
      ...(base ? { host: base.hostname, port: Number(base.port || (base.protocol === "https:" ? 443 : 80)), protocol: base.protocol.replace(":", "") as "http" | "https" } : {}),
    });
  }
  if (env === process.env) cached = client;
  return client;
}

export const webhookSecret = (env: NodeJS.ProcessEnv = process.env) => env.STRIPE_WEBHOOK_SECRET?.trim() || null;
/** Stripe Tax computes VAT in Checkout when the account has it on (STRIPE_TAX=1). */
export const automaticTax = (env: NodeJS.ProcessEnv = process.env) => env.STRIPE_TAX === "1";

/** Stripe price id per lookup key (only active prices). */
export async function pricesByLookupKey(stripe: Stripe, keys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < keys.length; i += 10) {
    const list = await stripe.prices.list({ lookup_keys: keys.slice(i, i + 10), active: true, limit: 100 });
    for (const p of list.data) if (p.lookup_key) out.set(p.lookup_key, p.id);
  }
  return out;
}

/** Stripe Tax product category: "Software as a service (SaaS) – business use" (TASK-036, ADR-074). */
export const TAX_CODE = "txcd_10103001";

/** Creates the products and prices that are missing (by lookup key); returns what exists afterwards. Idempotent. */
export async function ensureStripeCatalog(stripe: Stripe): Promise<{ created: string[]; existing: string[] }> {
  const want = catalogPrices();
  const have = await pricesByLookupKey(stripe, want.map((w) => w.key));
  const created: string[] = [];
  const products = new Map<string, string>();
  for (const w of want) {
    if (have.has(w.key)) continue;
    let product = products.get(w.product);
    if (!product) {
      product = (await stripe.products.create({ name: w.product, tax_code: TAX_CODE, metadata: { postaja: "1" } })).id;
      products.set(w.product, product);
    }
    await stripe.prices.create({
      product, currency: "eur", unit_amount: w.cents, lookup_key: w.key, tax_behavior: "exclusive",
      ...(w.interval ? { recurring: { interval: w.interval } } : {}),
    });
    created.push(w.key);
  }
  // Products made before Stripe Tax was on get their tax category now.
  const existing = await stripe.prices.list({ lookup_keys: [...have.keys()].slice(0, 10), expand: ["data.product"], limit: 100 }).catch(() => null);
  const more = have.size > 10 ? await stripe.prices.list({ lookup_keys: [...have.keys()].slice(10), expand: ["data.product"], limit: 100 }).catch(() => null) : null;
  const seen = new Set<string>();
  for (const p of [...(existing?.data ?? []), ...(more?.data ?? [])]) {
    const prod = p.product as { id: string; tax_code?: string | { id: string } | null } | string;
    if (typeof prod === "string" || seen.has(prod.id)) continue;
    seen.add(prod.id);
    if (!prod.tax_code) await stripe.products.update(prod.id, { tax_code: TAX_CODE });
  }
  return { created, existing: [...have.keys()] };
}
