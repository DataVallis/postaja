import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClass, Card } from "@/components/ui";
import { billingBlock } from "@/server/billing/block";
import { PAID_PLANS, PILOT, PLAN_CATALOG, YEAR_MONTHS } from "@/server/billing/catalog";
import type { BillingRow } from "@/server/billing/service";
import { checkoutAction, portalAction } from "./actions";

/** Plan and subscription (TASK-036): the state from Stripe, plans to buy, the pilot, the customer portal. */
export async function BillingSection({ billing, isOwner, configured, now }: { billing: BillingRow | null; isOwner: boolean; configured: boolean; now: Date }) {
  const t = await getTranslations("Team.billing");
  const f = await getFormatter();
  const date = (d: Date | null | undefined) => (d ? f.dateTime(d, { dateStyle: "medium" }) : "");
  const live = !!billing?.stripeSubscriptionId && ["active", "trialing", "past_due"].includes(billing.status);
  const pilotRunning = !!billing?.pilotEndsAt && billing.pilotEndsAt > now;
  const block = billingBlock(billing, now);
  const state = live
    ? billing!.status === "past_due" ? t("pastDue") : billing!.cancelAtPeriodEnd ? t("endsOn", { date: date(billing!.currentPeriodEnd) }) : t("renewsOn", { date: date(billing!.currentPeriodEnd), interval: t(`intervals.${billing!.interval ?? "month"}`) })
    : pilotRunning ? t("pilotUntil", { date: date(billing!.pilotEndsAt) }) : block ? t("ended") : null;
  const canPilot = !billing || (billing.status === "none" && !billing.pilotEndsAt);
  return (
    <section aria-labelledby="billing-h" className="mb-8 grid gap-3" data-testid="team-billing">
      <h2 id="billing-h" className="text-base font-semibold">{t("title")}</h2>
      {state ? <p role={block || billing?.status === "past_due" ? "alert" : undefined} className={`text-sm ${block ? "text-danger" : ""}`} data-testid="billing-state">{state}</p> : null}
      {!configured ? <p className="text-sm text-muted">{t("notConfigured")}</p> : null}
      {configured && isOwner && live ? (
        <form action={portalAction}><button type="submit" className={buttonClass("secondary")}>{t("manage")}</button></form>
      ) : null}
      {configured && isOwner && !live ? (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            {PAID_PLANS.map((p) => {
              const c = PLAN_CATALOG[p];
              return (
                <Card key={p} className="grid content-start gap-3 p-4 text-sm" data-testid={`plan-${p}`}>
                  <div>
                    <p className="text-base font-semibold">{c.name}</p>
                    <p className="text-muted">{t("limits", { brands: c.limits.brands, members: c.limits.members, credits: c.limits.creditsPerMonth.toLocaleString("sl-SI") })}</p>
                  </div>
                  <form action={checkoutAction} className="flex flex-wrap gap-2">
                    <input type="hidden" name="kind" value="plan" /><input type="hidden" name="plan" value={p} />
                    <button type="submit" name="interval" value="month" className={buttonClass("primary", "sm")} aria-label={t("buyMonthLabel", { plan: c.name, price: c.priceEur })}>{t("buyMonth", { price: c.priceEur })}</button>
                    <button type="submit" name="interval" value="year" className={buttonClass("secondary", "sm")} aria-label={t("buyYearLabel", { plan: c.name, price: c.priceEur * YEAR_MONTHS })}>{t("buyYear", { price: c.priceEur * YEAR_MONTHS })}</button>
                  </form>
                </Card>
              );
            })}
          </div>
          {canPilot ? (
            <form action={checkoutAction} className="flex flex-wrap items-center gap-3 text-sm">
              <input type="hidden" name="kind" value="pilot" />
              <button type="submit" className={buttonClass("secondary", "sm")}>{t("pilot", { price: PILOT.priceEur })}</button>
              <span className="text-muted">{t("pilotHint", { days: PILOT.days, brands: PILOT.limits.brands })}</span>
            </form>
          ) : null}
          <p className="text-xs text-muted">{t("vatHint")}</p>
        </>
      ) : null}
    </section>
  );
}
