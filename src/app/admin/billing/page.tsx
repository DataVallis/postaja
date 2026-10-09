import { desc, eq } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClass, inputClass } from "@/components/ui";
import { requireSuperadmin } from "@/server/admin/guard";
import { catalogPrices } from "@/server/billing/catalog";
import { automaticTax, getStripe, pricesByLookupKey, webhookSecret } from "@/server/billing/stripe";
import { getDb } from "@/server/db/client";
import { orgBilling, organization, stripeEvents } from "@/server/db/schema";
import { listPayments } from "@/server/billing/service";
import { ensureCatalogAction, setInvoiceNumberAction } from "./actions";

export const dynamic = "force-dynamic";

/** Payments (TASK-036, ADR-073): is Stripe set up, which prices exist, subscriptions, the latest webhook events. */
export default async function BillingAdminPage({ searchParams }: { searchParams: Promise<{ created?: string; error?: string; all?: string; invoice?: string }> }) {
  const actor = await requireSuperadmin();
  const sp = await searchParams;
  const t = await getTranslations("Admin.billing");
  const f = await getFormatter();
  const db = getDb();
  const stripe = getStripe();
  const want = catalogPrices();
  let found: Map<string, string> | null = null;
  let stripeError = false;
  if (stripe) {
    try {
      found = await pricesByLookupKey(stripe, want.map((w) => w.key));
    } catch {
      stripeError = true;
    }
  }
  const all = sp.all === "1";
  const eur = (c: number) => `${(c / 100).toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const [payments, subs, events] = await Promise.all([
    listPayments(db, actor, { open: !all, limit: 200 }),
    db.select({ b: orgBilling, name: organization.name }).from(orgBilling).innerJoin(organization, eq(organization.id, orgBilling.orgId)).orderBy(desc(orgBilling.updatedAt)).limit(100),
    db.select().from(stripeEvents).orderBy(desc(stripeEvents.processedAt)).limit(30),
  ]);
  const yes = (v: boolean) => (v ? t("yes") : t("no"));
  return (
    <div className="grid max-w-4xl gap-8">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("intro")}</p>
      </div>
      {sp.created !== undefined ? <p role="status" className="text-sm text-signal">{t("created", { n: Number(sp.created) })}</p> : null}
      {sp.error ? <p role="alert" className="text-sm text-danger">{t(`errors.${sp.error === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "STRIPE"}`)}</p> : null}

      <section aria-labelledby="setup-h" className="grid gap-2 text-sm" data-testid="billing-setup">
        <h2 id="setup-h" className="text-lg font-semibold">{t("setup")}</h2>
        <p>STRIPE_SECRET_KEY: {yes(!!stripe)} · STRIPE_WEBHOOK_SECRET: {yes(!!webhookSecret())} · STRIPE_TAX: {yes(automaticTax())}</p>
        <p className="text-muted">{t("webhookHint")}</p>
        {stripeError ? <p role="alert" className="text-danger">{t("errors.STRIPE")}</p> : null}
        {found ? (
          <ul className="grid gap-1" data-testid="billing-prices">
            {want.map((w) => (
              <li key={w.key}><span className="font-mono text-xs">{w.key}</span> · {(w.cents / 100).toLocaleString("sl-SI")} € {w.interval ? `/ ${t(`intervals.${w.interval}`)}` : ""} · {found!.has(w.key) ? t("present") : <strong>{t("missing")}</strong>}</li>
            ))}
          </ul>
        ) : null}
        {stripe ? <form action={ensureCatalogAction}><button type="submit" className={buttonClass("primary")}>{t("ensure")}</button></form> : null}
      </section>

      <section aria-labelledby="payments-h" className="grid gap-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="payments-h" className="text-lg font-semibold">{t("payments")}</h2>
          <div className="flex flex-wrap gap-2">
            <a href={all ? "/admin/billing#payments-h" : "/admin/billing?all=1#payments-h"} className={buttonClass("ghost", "sm")}>{all ? t("onlyOpen") : t("showAll")}</a>
            <a href={`/admin/billing/payments.csv${all ? "" : "?open=1"}`} className={buttonClass("secondary", "sm")}>{t("csv")}</a>
          </div>
        </div>
        <p className="text-muted">{t("paymentsHint")}</p>
        {sp.invoice ? <p role="status" className="text-signal">{t("invoiceSaved")}</p> : null}
        {payments.length === 0 ? <p className="text-muted">{all ? t("none") : t("noneOpen")}</p> : (
          <div className="grid gap-2" data-testid="billing-payments">
            {payments.map((p) => (
              <div key={p.id} className="grid gap-2 rounded-lg border border-line p-3 md:grid-cols-[1fr_auto] md:items-center" data-testid="billing-payment">
                <div className="grid gap-0.5">
                  <p><strong>{p.buyerName || p.buyerEmail || "—"}</strong> · {f.dateTime(p.paidAt, { dateStyle: "medium" })} · {p.description}</p>
                  <p className="text-xs text-muted">
                    {p.buyerAddress || "—"}{p.buyerVatId ? ` · ${t("vatId")} ${p.buyerVatId}` : ""}{p.buyerEmail ? ` · ${p.buyerEmail}` : ""}
                    {p.periodStart && p.periodEnd ? ` · ${t("period", { from: f.dateTime(p.periodStart, { dateStyle: "short" }), to: f.dateTime(p.periodEnd, { dateStyle: "short" }) })}` : ""}
                  </p>
                  <p>{t("amounts", { net: eur(p.netCents), tax: eur(p.taxCents), total: eur(p.totalCents) })}{p.reverseCharge ? <strong> · {t("reverseCharge")}</strong> : null}</p>
                </div>
                <form action={setInvoiceNumberAction} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={p.id} />{all ? <input type="hidden" name="all" value="1" /> : null}
                  <label className="sr-only" htmlFor={`inv-${p.id}`}>{t("invoiceNumberFor", { buyer: p.buyerName || p.buyerEmail || p.id })}</label>
                  <input id={`inv-${p.id}`} name="number" defaultValue={p.invoiceNumber ?? ""} placeholder={t("invoiceNumber")} maxLength={60} className={`${inputClass} w-36`} />
                  <button type="submit" className={buttonClass("secondary", "sm")}>{t("save")}</button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="subs-h" className="grid gap-2 text-sm">
        <h2 id="subs-h" className="text-lg font-semibold">{t("subscriptions")}</h2>
        {subs.length === 0 ? <p className="text-muted">{t("none")}</p> : (
          <ul className="grid gap-1" data-testid="billing-subs">
            {subs.map(({ b, name }) => (
              <li key={b.orgId}>
                <strong>{name}</strong> · {b.plan ?? "—"} · {b.status}{b.interval ? ` · ${t(`intervals.${b.interval}`)}` : ""}
                {b.currentPeriodEnd ? ` · ${t("until", { date: f.dateTime(b.currentPeriodEnd, { dateStyle: "medium" }) })}` : ""}
                {b.cancelAtPeriodEnd ? ` · ${t("cancels")}` : ""}
                {b.pilotEndsAt ? ` · ${t("pilotUntil", { date: f.dateTime(b.pilotEndsAt, { dateStyle: "medium" }) })}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="events-h" className="grid gap-2 text-sm">
        <h2 id="events-h" className="text-lg font-semibold">{t("events")}</h2>
        {events.length === 0 ? <p className="text-muted">{t("none")}</p> : (
          <ul className="grid gap-1 font-mono text-xs" data-testid="billing-events">
            {events.map((e) => <li key={e.id}>{f.dateTime(e.processedAt, { dateStyle: "short", timeStyle: "medium" })} · {e.type} · {e.outcome}</li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
