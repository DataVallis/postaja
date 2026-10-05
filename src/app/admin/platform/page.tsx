import { getTranslations } from "next-intl/server";
import { requireSuperadmin } from "@/server/admin/guard";
import { getDb } from "@/server/db/client";
import { listPlatformRules, listPresets } from "@/server/rules/repo";

const dash = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("sl-SI"));
const mb = (b: number | null) => (b === null ? "—" : b >= 1e9 ? `${b / 1e9} GB` : b >= 1e6 ? `${b / 1e6} MB` : `${b / 1e3} KB`);

export default async function PlatformPage() {
  await requireSuperadmin();
  const t = await getTranslations("Admin");
  const db = getDb();
  const [rules, presets] = await Promise.all([listPlatformRules(db), listPresets(db)]);
  return (
    <main className="grid gap-10">
      <div>
        <h1 className="text-2xl font-bold">{t("platform")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("platformIntro")}</p>
      </div>
      <section aria-labelledby="rules-h">
        <h2 id="rules-h" className="mb-3 text-lg font-semibold">{t("platformRules")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="platform-rules">
            <thead className="text-muted">
              <tr>
                {["platformCol", "captionMax", "visibleChars", "hashtagsMax", "slides", "links", "confidence", "verified"].map((k) => (
                  <th key={k} className="py-2 pr-4 font-medium">{t(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.platform} className="border-t border-muted/20 align-top">
                  <td className="py-2 pr-4 font-semibold">{r.platform}</td>
                  <td className="py-2 pr-4">{dash(r.captionMax)}{r.counting === "x_weighted" ? " *" : ""}</td>
                  <td className="py-2 pr-4">{dash(r.visibleChars)}</td>
                  <td className="py-2 pr-4">{dash(r.hashtagsMax)}</td>
                  <td className="py-2 pr-4">{r.slidesMin === null && r.slidesMax === null ? "—" : `${r.slidesMin ?? "—"}–${r.slidesMax ?? "—"}`}</td>
                  <td className="py-2 pr-4">{r.linksClickable ? t("yes") : t("no")}</td>
                  <td className="py-2 pr-4">{t(`conf.${r.confidence}`)}</td>
                  <td className="py-2 pr-4" title={`${r.source}${r.notes ? ` — ${r.notes}` : ""}`}>{r.verifiedAt}</td>
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
                {["key", "size", "media", "maxSize", "duration", "safeZone", "confidence"].map((k) => (
                  <th key={k} className="py-2 pr-4 font-medium">{t(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {presets.map((p) => (
                <tr key={p.key} className={`border-t border-muted/20 ${p.enabled ? "" : "opacity-50"}`}>
                  <td className="py-2 pr-4 font-mono text-xs" title={`${p.source}${p.notes ? ` — ${p.notes}` : ""}`}>{p.key}</td>
                  <td className="py-2 pr-4">{p.width}×{p.height}</td>
                  <td className="py-2 pr-4">{p.media}</td>
                  <td className="py-2 pr-4">{mb(p.maxBytes)}</td>
                  <td className="py-2 pr-4">{p.media === "video" ? `${p.minDurationS ?? 0}–${p.maxDurationS ?? "∞"} s` : "—"}</td>
                  <td className="py-2 pr-4 text-xs">{`${p.safeZone.top}/${p.safeZone.right}/${p.safeZone.bottom}/${p.safeZone.left}`}</td>
                  <td className="py-2 pr-4">{t(`conf.${p.confidence}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
