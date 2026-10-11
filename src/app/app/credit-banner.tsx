import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { billingBlock } from "@/server/billing/block";
import { GRACE_DAYS } from "@/server/billing/catalog";
import { billingFor } from "@/server/billing/service";
import { creditStatus } from "@/server/credits/service";
import { getDb } from "@/server/db/client";

/**
 * On every app page: a running or ended trial (TASK-037) or a subscription that stopped or failed to renew (TASK-036) comes first, then credits at 80 % and
 * used up (TASK-038); each links to Ekipa in paket.
 */
export async function CreditBanner({ orgId }: { orgId: string }) {
  const now = new Date();
  const [b, s] = await Promise.all([billingFor(getDb(), orgId).catch(() => null), creditStatus(getDb(), orgId).catch(() => null)]);
  const block = billingBlock(b, now);
  const trialEnded = block === "ENDED" && !!b?.trialEndsAt && b.trialEndsAt <= now && !b.stripeSubscriptionId && !b.pilotEndsAt;
  // A running self-serve trial (TASK-037): how long it lasts, and the way to a plan.
  if (!block && b?.trialEndsAt && b.trialEndsAt > now && b.status === "none" && !(b.pilotEndsAt && b.pilotEndsAt > now)) {
    const t = await getTranslations("Team.billing");
    const f = await getFormatter();
    const days = Math.max(1, Math.ceil((b.trialEndsAt.getTime() - now.getTime()) / 86_400_000));
    return (
      <p role="status" data-testid="trial-banner" className="mb-4 rounded-lg border border-signal/50 p-3 text-sm">
        {t("bannerTrial", { days, date: f.dateTime(b.trialEndsAt, { dateStyle: "medium" }) })}{" "}
        <Link href="/app/team#billing-h" className="font-semibold underline underline-offset-4">{t("bannerTrialLink")}</Link>
      </p>
    );
  }
  if (block || b?.status === "past_due") {
    const t = await getTranslations("Team.billing");
    const f = await getFormatter();
    const until = b?.pastDueSince ? f.dateTime(new Date(b.pastDueSince.getTime() + GRACE_DAYS * 86_400_000), { dateStyle: "medium" }) : "";
    return (
      <p role="alert" data-testid="billing-banner" className="mb-4 rounded-lg border border-danger/60 p-3 text-sm">
        {trialEnded ? t("bannerTrialEnded") : block === "ENDED" ? t("bannerEnded") : block === "PAST_DUE" ? t("bannerBlocked") : t("bannerPastDue", { until })}{" "}
        <Link href="/app/team#billing-h" className="font-semibold underline underline-offset-4">{t("bannerLink")}</Link>
      </p>
    );
  }
  if (!s || s.level === "ok") return null;
  const t = await getTranslations("Team.credits");
  return (
    <p role="status" data-testid="credit-banner" className={`mb-4 rounded-lg border p-3 text-sm ${s.level === "out" ? "border-danger/60" : "border-signal/50"}`}>
      {t(s.level === "out" ? "bannerOut" : "bannerWarn", { available: s.available ?? 0 })}{" "}
      <Link href="/app/team#credits-h" className="font-semibold underline underline-offset-4">{t("bannerLink")}</Link>
    </p>
  );
}
