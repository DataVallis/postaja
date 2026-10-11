import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, Card, DataTable, inputClass, selectClass, td, textareaClass } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import type { AdNetworkInfo } from "@/server/ads/service";
import { AD_OBJECTIVES, type adSets } from "@/server/db/schema";
import { createAdSetAction } from "../../ads/actions";

type AdSet = typeof adSets.$inferSelect;
const TONE = { draft: "neutral", ready: "ok", needs_review: "warn" } as const;

/** Ads of a brand (TASK-021): one concept per ad set, written for every chosen network and placement. */
export async function AdsSection({ brandId, archived, languages, networks, sets, error }: { brandId: string; archived: boolean; languages: string[]; networks: AdNetworkInfo[]; sets: AdSet[]; error?: string }) {
  const t = await getTranslations("Ads");
  const tb = await getTranslations("Brands");
  const f = await getFormatter();
  return (
    <section aria-labelledby="ads-h" className="grid gap-6">
      {archived ? null : (
        <Card className="grid gap-4 p-5" data-testid="ad-form">
          <div>
            <h2 id="ads-h" className="text-base font-semibold">{t("newTitle")}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">{t("newHint")}</p>
          </div>
          {error ? <p role="alert" className="text-sm text-danger">{t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.FAILED")}</p> : null}
          <form action={createAdSetAction} className="grid gap-4">
            <input type="hidden" name="brandId" value={brandId} />
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-1">
                <label htmlFor="ad-objective" className="text-sm font-medium">{t("objective")}</label>
                <select id="ad-objective" name="objective" defaultValue="traffic" className={selectClass}>
                  {AD_OBJECTIVES.map((o) => <option key={o} value={o}>{t(`objectives.${o}`)}</option>)}
                </select>
              </div>
              <div className="grid gap-1">
                <label htmlFor="ad-landing" className="text-sm font-medium">{t("landingUrl")}</label>
                <input id="ad-landing" name="landingUrl" inputMode="url" placeholder="https://" className={inputClass} />
              </div>
              {languages.length > 1 ? (
                <div className="grid gap-1">
                  <label htmlFor="ad-language" className="text-sm font-medium">{t("language")}</label>
                  <select id="ad-language" name="language" defaultValue={languages[0]} className={selectClass}>
                    {languages.map((l) => <option key={l} value={l}>{tb(`lang.${l as "sl"}`)}</option>)}
                  </select>
                </div>
              ) : null}
            </div>
            <div className="grid gap-1">
              <label htmlFor="ad-offer" className="text-sm font-medium">{t("offer")}</label>
              <textarea id="ad-offer" name="offer" rows={2} maxLength={2000} placeholder={t("offerPlaceholder")} className={textareaClass} />
            </div>
            <div className="grid gap-1">
              <label htmlFor="ad-brief" className="text-sm font-medium">{t("brief")}</label>
              <textarea id="ad-brief" name="brief" rows={2} maxLength={4000} placeholder={t("briefPlaceholder")} className={textareaClass} />
            </div>
            <fieldset className="grid gap-3">
              <legend className="mb-2 text-sm font-medium">{t("networks")}</legend>
              <div className="grid gap-3 md:grid-cols-3">
                {networks.map((n, i) => (
                  <div key={n.key} className="grid content-start gap-2 rounded-lg border border-line p-3">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" name="networks" value={n.key} defaultChecked={i === 0} /> {n.label}
                    </label>
                    <div className="grid gap-1 pl-6">
                      {n.placements.map((p) => (
                        <label key={p.key} className="flex items-center gap-2 text-xs text-muted">
                          <input type="checkbox" name="placements" value={p.key} defaultChecked /> {t(`placements.${p.placement}`)} · {p.width}×{p.height}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-1 sm:max-w-sm">
              <label htmlFor="ad-name" className="text-sm font-medium">{t("name")}</label>
              <input id="ad-name" name="name" maxLength={120} placeholder={t("namePlaceholder")} className={inputClass} />
            </div>
            <div><SubmitButton pending={t("writing")}>{t("create")}</SubmitButton></div>
          </form>
        </Card>
      )}

      <DataTable testId="ad-sets" head={[t("name"), t("objective"), t("networks"), t("statusCol"), t("created")]} empty={sets.length ? undefined : t("none")}>
        {sets.map((s) => (
          <tr key={s.id}>
            <td className={`${td} font-medium`}><Link href={`/app/ads/${s.id}`} className="hover:underline">{s.name}</Link></td>
            <td className={`${td} text-muted`}>{t(`objectives.${s.objective}`)}</td>
            <td className={`${td} text-muted`}>{s.networks.map((k) => networks.find((n) => n.key === k)?.label ?? k).join(", ")}</td>
            <td className={td}><Badge tone={TONE[s.status]} dot>{t(`status.${s.status}`)}</Badge></td>
            <td className={`${td} whitespace-nowrap text-muted`}>{f.dateTime(s.createdAt, { dateStyle: "medium", timeStyle: "short" })}</td>
          </tr>
        ))}
      </DataTable>
    </section>
  );
}
