import { Cpu } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonClass, Card, selectClass } from "@/components/ui";
import { setBrandModelAction } from "../actions";

type Model = { id: string; label: string; isDefault: boolean; inputPerMtok: bigint; outputPerMtok: bigint };
const usd = (micro: bigint) => `${(Number(micro) / 1_000_000).toFixed(2)} €`;

/** Which Claude model writes this brand's texts, designs and image plans (owner; empty = platform default). */
export async function ModelSection({ brandId, models, current, isOwner, saved }: { brandId: string; models: Model[]; current: string | null; isOwner: boolean; saved: boolean }) {
  const t = await getTranslations("Brands.model");
  const def = models.find((m) => m.isDefault);
  return (
    <Card className="mb-6 grid gap-3 p-5" data-testid="brand-model">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Cpu aria-hidden className="size-4 text-muted" />{t("title")}</h3>
      <p className="text-xs text-muted">{t("hint")}</p>
      <form action={setBrandModelAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="brandId" value={brandId} />
        <label htmlFor="brand-model" className="sr-only">{t("title")}</label>
        <select id="brand-model" name="modelId" defaultValue={current ?? ""} disabled={!isOwner} className={`${selectClass} min-w-72`}>
          <option value="">{t("default", { label: def?.label ?? "—" })}</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>{t("option", { label: m.label, input: usd(m.inputPerMtok), output: usd(m.outputPerMtok) })}</option>
          ))}
        </select>
        {isOwner ? <button type="submit" className={buttonClass("secondary", "sm")}>{t("save")}</button> : null}
        {saved ? <span role="status" className="text-sm text-muted">{t("saved")}</span> : null}
      </form>
    </Card>
  );
}
