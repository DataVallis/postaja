import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSuperadmin } from "@/server/admin/guard";
import { getDb } from "@/server/db/client";
import { countDueForReverification, listPlatformRules, listPresets } from "@/server/rules/repo";
import { isDueForReverification } from "@/server/rules/verification";
import { ReverifyBanner } from "../reverify-banner";

const dash = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("sl-SI"));
const mb = (b: number | null) => (b === null ? "—" : b >= 1e9 ? `${b / 1e9} GB` : b >= 1e6 ? `${b / 1e6} MB` : `${b / 1e3} KB`);

export default async function PlatformPage() {
  await requireSuperadmin();
  const t = await getTranslations("Admin");
  const db = getDb();
  const [rules, presets, due] = await Promise.all([listPlatformRules(db), listPresets(db), countDueForReverification(db)]);
  const Due = ({ at }: { at: string }) =>
    isDueForReverification(at) ? <span className="ml-1 rounded bg-signal/20 px-1 text-xs font-semibold">{t("reverify.badge")}</span> : null;
  return (
    <main className="grid gap-10">
      <div>
        <h1 className="text-2xl font-bold">{t("platform")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("platformIntro")}</p>
      </div>
      <ReverifyBanner rules={due.rules} presets={due.presets} link={false} />
      <section aria-labelledby="rules-h">
        <h2 id="rules-h" className="mb-3 text-lg font-semibold">{t("platformRules")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="platform-rules">
            <thead className="text-muted">
              <tr>
                {["platformCol", "captionMax", "visibleChars", "hashtagsMax", "slides", "links", "confidence", "verified", "sourceNotes"].map((k) => (
                  <th key={k} className="py-2 pr-4 font-medium">{t(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.platform} className="border-t border-muted/20 align-top">
                  <td className="py-2 pr-4 font-semibold">
                    <Link href={`/admin/platform/rules/${r.platform}`} aria-label={t("edit.editLabel", { name: r.platform })} className="underline-offset-4 hover:underline">{r.platform}</Link>
                  </td>
                  <td className="py-2 pr-4">{dash(r.captionMax)}{r.counting === "x_weighted" ? " *" : ""}</td>
                  <td className="py-2 pr-4">{dash(r.visibleChars)}</td>
                  <td className="py-2 pr-4">{dash(r.hashtagsMax)}</td>
                  <td className="py-2 pr-4">{r.slidesMin === null && r.slidesMax === null ? "—" : `${r.slidesMin ?? "—"}–${r.slidesMax ?? "—"}`}</td>
                  <td className="py-2 pr-4">{r.linksClickable ? t("yes") : t("no")}</td>
                  <td className="py-2 pr-4">{t(`conf.${r.confidence}`)}</td>
                  <td className="py-2 pr-4">{r.verifiedAt}<Due at={r.verifiedAt} /></td>
                  <td className="min-w-64 py-2 pr-4 text-xs">
                    <span className="block text-muted">{r.source}</span>
                    {r.notes ? <span className="mt-1 block">{r.notes}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">{t("xWeighted")}</p>
      </section>
      <section aria-labelledby="presets-h">
        <h2 id="presets-h" className="mb-3 text-lg font-semibold">{t("presets")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="presets">
            <thead className="text-muted">
              <tr>
                {["key", "size", "media", "maxSize", "duration", "safeZone", "confidence", "sourceNotes"].map((k) => (
                  <th key={k} className="py-2 pr-4 font-medium">{t(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {presets.map((p) => (
                <tr key={p.key} className={`border-t border-muted/20 ${p.enabled ? "" : "opacity-50"}`}>
                  <td className="py-2 pr-4 font-mono text-xs">
                    <Link href={`/admin/platform/presets/${p.key}`} aria-label={t("edit.editLabel", { name: p.key })} className="underline-offset-4 hover:underline">{p.key}</Link>
                    {p.enabled ? null : <span className="ml-1 font-sans">({t("edit.disabled")})</span>}
                  </td>
                  <td className="py-2 pr-4">{p.width}×{p.height}</td>
                  <td className="py-2 pr-4">{p.media}</td>
                  <td className="py-2 pr-4">{mb(p.maxBytes)}</td>
                  <td className="py-2 pr-4">{p.media === "video" ? `${p.minDurationS ?? 0}–${p.maxDurationS ?? "∞"} s` : "—"}</td>
                  <td className="py-2 pr-4 text-xs">{`${p.safeZone.top}/${p.safeZone.right}/${p.safeZone.bottom}/${p.safeZone.left}`}</td>
                  <td className="py-2 pr-4">{t(`conf.${p.confidence}`)}</td>
                  <td className="min-w-64 py-2 pr-4 text-xs">
                    <span className="block text-muted">{p.source} · {p.verifiedAt}<Due at={p.verifiedAt} /></span>
                    {p.notes ? <span className="mt-1 block">{p.notes}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
