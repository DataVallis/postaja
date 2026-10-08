import { desc, eq } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/ui";
import { requireSuperadmin } from "@/server/admin/guard";
import { catalogPrices } from "@/server/billing/catalog";
import { automaticTax, getStripe, pricesByLookupKey, webhookSecret } from "@/server/billing/stripe";
import { getDb } from "@/server/db/client";
import { orgBilling, organization, stripeEvents } from "@/server/db/schema";
import { ensureCatalogAction } from "./actions";

export const dynamic = "force-dynamic";

/** Payments (TASK-036, ADR-073): is Stripe set up, which prices exist, subscriptions, the latest webhook events. */
export default async function BillingAdminPage({ searchParams }: { searchParams: Promise<{ created?: string; error?: string }> }) {
  await requireSuperadmin();
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
  const [subs, events] = await Promise.all([
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
