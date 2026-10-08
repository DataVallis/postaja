# Payments (Stripe)

Status: **Built** (TASK-036). Decision: ADR-073. Owner: prices from business plan §4, provider Stripe (2026-10-08).

## What
- **Ekipa in paket → Paket in plačilo** (owners): Solo / Studio / Agencija, each *monthly* or *yearly* (10 × monthly),
  the *agency pilot* (99 €, 30 days of Studio with 3 brands, once, before a subscription) → Stripe Checkout. With a
  subscription: its state (renews on / cancelled, runs until / payment failed) and *Upravljaj naročnino* → Stripe's
  customer portal (card, invoices, plan change, cancel). Credit packs (500 / 25 €, 2,000 / 80 €) also go through
  Checkout when Stripe is on (else the request flow of ADR-071).
- Banner on every app page when a payment failed (until when it still works), when work is stopped, when the plan ended.
- **/admin/billing**: which variables are set (names only), which catalogue prices exist in Stripe, *Pripravi cenik v
  Stripe* (creates missing products and prices by lookup key, audited), subscriptions, the latest webhook events.

## How
- `src/server/billing/catalog.ts`: plans, limits, pilot, packs, lookup keys (`postaja_<plan>_<month|year>`,
  `postaja_pilot`, `postaja_credits_<n>`), `planFromLookupKey`.
- `src/server/billing/stripe.ts`: client from `STRIPE_SECRET_KEY` (`STRIPE_API_BASE` = test stand-in), webhook
  secret, `STRIPE_TAX`, `pricesByLookupKey`, `ensureStripeCatalog`.
- `src/server/billing/service.ts`: `checkoutUrl` (owner; one customer per org; subscription vs payment mode; Stripe
  Tax when on; VAT ids; required billing address; invoices for one-off payments), `portalUrl`, `handleStripeEvent`
  (once per event id): `checkout.session.completed` / `async_payment_succeeded` → pilot or pack;
  `customer.subscription.created|updated|deleted` → `org_billing` + plan and limits while active/trialing.
- `src/server/billing/block.ts` `billingBlock`: past_due > 7 days, canceled / unpaid / paused, ended pilot → `reserve`
  throws `BillingBlockedError` (a `SpendCapError`). No `org_billing` row = managed by hand, never blocked here.
- Webhook route `src/app/api/stripe/webhook/route.ts` (raw body, `stripe-signature`; 400 bad signature, 500 retry).
- Migration 0044: `org_billing`, `stripe_events`, plans `solo`, `studio`, `agency`, `partner`, `pilot`.
- Deploy (dev): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` from GitHub environment `dev`; `STRIPE_TAX` clear.

## Owner setup (Stripe dashboard, test mode first)
1. API secret key → GitHub environment `dev` secret `STRIPE_SECRET_KEY`.
2. Webhook endpoint `https://dev-postaja.inzenirji.si/api/stripe/webhook` with the events above → its signing secret
   → `STRIPE_WEBHOOK_SECRET`.
3. Customer portal: allow plan changes (the three plans, both intervals) and cancelling.
4. Optional: Stripe Tax on → `STRIPE_TAX: "1"` in `config/deploy.dev.yml`.
5. /admin/billing → *Pripravi cenik v Stripe*.

## Tests
`billing.int.test.ts` (checkout: owners only, one customer, lookup keys, one subscription, one pilot; webhooks once;
plan + limits; cancelled → blocked; past_due grace; pilot then plan; packs; unknown orgs), E2E `billing.spec.ts`
(Studio monthly via the stand-in → signed webhooks → plan, limits, portal, admin view → cancelled → banner; forged
webhook 400) and `credits.spec.ts` (pack through Checkout + webhook).
