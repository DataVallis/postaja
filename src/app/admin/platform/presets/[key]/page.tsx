import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSuperadmin } from "@/server/admin/guard";
import { getDb } from "@/server/db/client";
import { getPresetRow } from "@/server/rules/repo";
import { todayIso } from "@/server/rules/verification";
import { PresetForm } from "../../forms";

export default async function EditPresetPage({ params }: { params: Promise<{ key: string }> }) {
  await requireSuperadmin();
  const { key } = await params;
  const preset = await getPresetRow(getDb(), key);
  if (!preset) notFound();
  const t = await getTranslations("Admin");
  return (
    <div className="grid gap-6">
      <div>
        <Link href="/admin/platform" className="text-sm text-muted underline-offset-4 hover:underline">← {t("platform")}</Link>
        <h1 className="mt-2 text-2xl font-bold">{t("edit.presetTitle", { key: preset.key })}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{preset.platform} · {preset.placement} · {preset.media}. {t("edit.intro")}</p>
      </div>
      <PresetForm preset={preset} today={todayIso()} />
    </div>
  );
}
