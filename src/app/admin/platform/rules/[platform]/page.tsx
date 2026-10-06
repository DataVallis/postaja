import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSuperadmin } from "@/server/admin/guard";
import { getDb } from "@/server/db/client";
import { getPlatformRuleRow } from "@/server/rules/repo";
import { todayIso } from "@/server/rules/verification";
import { RuleForm } from "../../forms";

export default async function EditRulePage({ params }: { params: Promise<{ platform: string }> }) {
  await requireSuperadmin();
  const { platform } = await params;
  const rule = await getPlatformRuleRow(getDb(), platform);
  if (!rule) notFound();
  const t = await getTranslations("Admin");
  return (
    <div className="grid gap-6">
      <div>
        <Link href="/admin/platform" className="text-sm text-muted underline-offset-4 hover:underline">← {t("platform")}</Link>
        <h1 className="mt-2 text-2xl font-bold">{t("edit.ruleTitle", { platform: rule.platform })}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("edit.intro")}</p>
      </div>
      <RuleForm rule={rule} today={todayIso()} />
    </div>
  );
}
