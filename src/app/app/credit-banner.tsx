import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { creditStatus } from "@/server/credits/service";
import { getDb } from "@/server/db/client";

/** TASK-038: at 80 % of this month's credits a notice, at 0 a stronger one; both lead to "Kupi kredite". */
export async function CreditBanner({ orgId }: { orgId: string }) {
  const s = await creditStatus(getDb(), orgId).catch(() => null);
  if (!s || s.level === "ok") return null;
  const t = await getTranslations("Team.credits");
  return (
    <p role="status" data-testid="credit-banner" className={`mb-4 rounded-lg border p-3 text-sm ${s.level === "out" ? "border-danger/60" : "border-signal/50"}`}>
      {t(s.level === "out" ? "bannerOut" : "bannerWarn", { available: s.available ?? 0 })}{" "}
      <Link href="/app/team#credits-h" className="font-semibold underline underline-offset-4">{t("bannerLink")}</Link>
    </p>
  );
}
