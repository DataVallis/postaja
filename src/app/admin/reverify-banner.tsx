import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** Quarterly re-verification reminder (ADR-032): shown on /admin and /admin/platform while anything is due. */
export async function ReverifyBanner({ rules, presets, link }: { rules: number; presets: number; link: boolean }) {
  if (rules + presets === 0) return null;
  const t = await getTranslations("Admin.reverify");
  return (
    <div role="note" data-testid="reverify" className="rounded-lg border border-signal px-4 py-3 text-sm">
      <p className="font-semibold">{t("title", { rules, presets })}</p>
      <p className="mt-1 text-muted">{t("body")}</p>
      {link ? <Link href="/admin/platform" className="mt-2 inline-block font-semibold underline underline-offset-4">{t("open")}</Link> : null}
    </div>
  );
}
