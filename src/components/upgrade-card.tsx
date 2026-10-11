import Link from "next/link";
import { Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonClass, Card } from "@/components/ui";
import { ADDONS, PLAN_CATALOG, planFor, type Feature } from "@/server/billing/catalog";

/**
 * In place of a tool the organization's plan does not include (TASK-053): what it is, which plan has it, and the way
 * there (owners: Paket in plačilo; editors: ask the owner).
 */
export async function UpgradeCard({ feature, isOwner, compact = false }: { feature: Feature; isOwner: boolean; compact?: boolean }) {
  const t = await getTranslations("Upgrade");
  const plan = PLAN_CATALOG[planFor(feature)];
  return (
    <Card className={`grid gap-3 border-signal/50 ${compact ? "p-4" : "p-6"}`} data-testid={`upgrade-${feature}`}>
      <div className="flex items-start gap-3">
        <Sparkles aria-hidden className="mt-0.5 size-5 shrink-0 text-signal" />
        <div className="grid gap-1">
          <p className="font-semibold">{t(`features.${feature}.title`)}</p>
          <p className="text-sm text-muted">{t(`features.${feature}.what`)}</p>
          <p className="text-sm">
            {feature === "persona"
              ? t("inPlanOrAddon", { plan: plan.name, price: ADDONS.persona.priceEur })
              : t("inPlan", { plan: plan.name, price: plan.priceEur })}
          </p>
        </div>
      </div>
      <div>
        {isOwner
          ? <Link href="/app/team#billing-h" className={buttonClass("primary", "sm")}>{t("cta")}</Link>
          : <p className="text-sm text-muted">{t("askOwner")}</p>}
      </div>
    </Card>
  );
}
