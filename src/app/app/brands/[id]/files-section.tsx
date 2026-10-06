import { getFormatter, getTranslations } from "next-intl/server";
import type { listBrandFiles } from "@/server/brands/files";
import { deleteBrandFileAction } from "../actions";
import { AddLogoButton, Dropzone, FontSample } from "../file-uploads";

type Files = Awaited<ReturnType<typeof listBrandFiles>>;
const size = (b: number) => (b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const href = (table: "source" | "asset", id: string) => `/api/brand-files/${table}/${id}`;
const TRASH = "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3";

function Delete({ brandId, table, id, label }: { brandId: string; table: "source" | "asset"; id: string; label: string }) {
  return (
    <form action={deleteBrandFileAction}>
      <input type="hidden" name="brandId" value={brandId} />
      <input type="hidden" name="table" value={table} />
      <input type="hidden" name="fileId" value={id} />
      <button type="submit" aria-label={label} title={label} className="grid size-8 place-items-center rounded-md text-muted hover:bg-signal/15 hover:text-fg focus-visible:outline-2 focus-visible:outline-fg">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4"><path d={TRASH} /></svg>
      </button>
    </form>
  );
}

/** Logos, fonts and brand sources of one brand (TASK-005b/c). Everyone in the org sees and downloads; owners add and delete. */
export async function FilesSection({ brandId, files, isOwner, archived, languages }: { brandId: string; files: Files; isOwner: boolean; archived: boolean; languages: string[] }) {
  const t = await getTranslations("Brands.files");
  const f = await getFormatter();
  const canUpload = isOwner && !archived;
  const needsDiacritics = languages.includes("sl");
  const sample = needsDiacritics ? "Čaša žgečkljivega šampanjca" : "The quick brown fox";
  return (
    <section aria-labelledby="files-h" className="grid gap-6">
      <div>
        <h2 id="files-h" className="text-lg font-semibold">{t("title")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("intro")}</p>
      </div>

      {canUpload ? <Dropzone brandId={brandId} needsDiacritics={needsDiacritics} /> : null}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="grid content-start gap-3">
          <h3 className="font-semibold">{t("logos")}</h3>
          {files.logos.length === 0 ? <p className="text-sm text-muted">{t("noLogos")}</p> : null}
          <ul className="grid grid-cols-2 gap-3" data-testid="logos">
            {files.logos.map((l) => (
              <li key={l.id} className="grid gap-2">
                <a href={href("asset", l.id)} className="grid h-28 place-items-center rounded-xl bg-paper p-4 ring-1 ring-ink/10 focus-visible:outline-2 focus-visible:outline-fg dark:bg-paper/90">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private presigned redirect, not optimisable */}
                  <img src={href("asset", l.id)} alt={t("logoAlt", { name: l.filename })} className="max-h-full max-w-full object-contain" />
                </a>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-muted">{l.filename}</span>
                  {isOwner ? <Delete brandId={brandId} table="asset" id={l.id} label={t("delete", { name: l.filename })} /> : null}
                </div>
              </li>
            ))}
          </ul>
          {canUpload ? <AddLogoButton brandId={brandId} /> : null}
        </div>

        <div className="grid content-start gap-3">
          <h3 className="font-semibold">{t("fonts")}</h3>
          {files.fonts.length === 0 ? <p className="text-sm text-muted">{t("noFonts")}</p> : null}
          <ul className="grid gap-3" data-testid="fonts">
            {files.fonts.map((ft) => {
              const missing = ft.meta.missingGlyphs ?? [];
              return (
                <li key={ft.id} className="grid gap-1 border-b border-muted/20 pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="truncate">{ft.meta.family ?? ft.filename}</strong>
                    {isOwner ? <Delete brandId={brandId} table="asset" id={ft.id} label={t("delete", { name: ft.filename })} /> : null}
                  </div>
                  <FontSample id={ft.id} sample={sample} />
                  <p className="text-xs text-muted">
                    <a href={href("asset", ft.id)} className="underline underline-offset-4">{ft.filename}</a>
                    {needsDiacritics ? <> · {missing.length ? t("missingGlyphs", { chars: missing.join(" ") }) : t("allGlyphs")}</> : null}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="grid gap-3">
        <h3 className="font-semibold">{t("sources")}</h3>
        {files.sources.length === 0 ? <p className="text-sm text-muted">{t("noSources")}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="sources">
              <thead className="text-muted">
                <tr className="border-b border-muted/25">
                  <th className="py-2 pr-4 font-medium">{t("file")}</th>
                  <th className="py-2 pr-4 font-medium">{t("kind")}</th>
                  <th className="py-2 pr-4 text-right font-medium">{t("size")}</th>
                  <th className="hidden py-2 pr-4 font-medium sm:table-cell">{t("added")}</th>
                  <th className="py-2 pr-4 font-medium">{t("status")}</th>
                  {isOwner ? <th className="w-10 py-2"><span className="sr-only">{t("actions")}</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {files.sources.map((s) => (
                  <tr key={s.id} className="border-b border-muted/15 last:border-0">
                    <td className="max-w-64 truncate py-2 pr-4"><a href={href("source", s.id)} className="underline underline-offset-4">{s.filename}</a></td>
                    <td className="py-2 pr-4"><span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs dark:bg-paper/10">{t(`kinds.${s.kind}`)}</span></td>
                    <td className="py-2 pr-4 text-right tabular-nums">{size(s.sizeBytes)}</td>
                    <td className="hidden py-2 pr-4 sm:table-cell">{f.dateTime(s.createdAt, { dateStyle: "medium" })}</td>
                    <td className="py-2 pr-4 text-muted">{t(`statuses.${s.status}`)}</td>
                    {isOwner ? <td className="py-1"><Delete brandId={brandId} table="source" id={s.id} label={t("delete", { name: s.filename })} /></td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
