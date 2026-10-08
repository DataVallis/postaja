import { getFormatter, getTranslations } from "next-intl/server";
import type { listBrandFiles } from "@/server/brands/files";
import { deleteBrandFileAction, renamePartnerLogoAction } from "../actions";
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
              <li key={l.id} className="grid min-w-0 gap-2">
                {/* Fixed frame; the image is scaled to fit inside it whatever its size or proportions. */}
                <a href={href("asset", l.id)} className="relative block h-28 overflow-hidden rounded-xl bg-paper ring-1 ring-line focus-visible:outline-2 focus-visible:outline-fg" data-testid="logo-frame">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private presigned redirect, not optimisable */}
                  <img src={href("asset", l.id)} alt={t("logoAlt", { name: l.filename })} className="absolute inset-0 h-full w-full object-contain p-4" />
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
                <li key={ft.id} className="grid gap-1 border-b border-line pb-3">
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

      <div className="grid content-start gap-3" data-testid="partners-section">
        <div>
          <h3 className="font-semibold">{t("partners")}</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t("partnersHint")}</p>
        </div>
        {files.partners.length === 0 ? <p className="text-sm text-muted">{t("noPartners")}</p> : null}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="partners">
          {files.partners.map((l) => (
            <li key={l.id} className="grid min-w-0 gap-2">
              <a href={href("asset", l.id)} className="relative block h-24 overflow-hidden rounded-xl bg-paper ring-1 ring-line focus-visible:outline-2 focus-visible:outline-fg">
                {/* eslint-disable-next-line @next/next/no-img-element -- private presigned redirect, not optimisable */}
                <img src={href("asset", l.id)} alt={t("logoAlt", { name: l.meta.name ?? l.filename })} className="absolute inset-0 h-full w-full object-contain p-3" />
              </a>
              {isOwner ? (
                <div className="flex items-center gap-1 text-xs">
                  <form key={l.meta.name ?? l.filename} action={renamePartnerLogoAction} className="flex min-w-0 flex-1 items-center gap-1">
                    <input type="hidden" name="brandId" value={brandId} />
                    <input type="hidden" name="fileId" value={l.id} />
                    <input name="name" defaultValue={l.meta.name ?? l.filename} maxLength={60} required aria-label={t("partnerName")} className="min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 py-1 text-xs" />
                    <button type="submit" className="rounded-md px-1.5 py-1 text-muted hover:bg-signal/15 hover:text-fg" aria-label={t("partnerRename", { name: l.meta.name ?? l.filename })} title={t("partnerRename", { name: l.meta.name ?? l.filename })}>✓</button>
                  </form>
                  <Delete brandId={brandId} table="asset" id={l.id} label={t("delete", { name: l.meta.name ?? l.filename })} />
                </div>
              ) : <strong className="truncate text-xs font-medium">{l.meta.name ?? l.filename}</strong>}
            </li>
          ))}
        </ul>
        {canUpload ? <Dropzone brandId={brandId} slot="partner" /> : null}
      </div>

      <div className="grid gap-3">
        <h3 className="font-semibold">{t("sources")}</h3>
        <p className="text-sm text-muted">{t("knowledgeHint")}</p>
        {files.sources.length === 0 ? <p className="text-sm text-muted">{t("noSources")}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="sources">
              <thead className="text-muted">
                <tr className="border-b border-line">
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
                  <tr key={s.id} className="border-b border-line last:border-0">
                    <td className="max-w-64 truncate py-2 pr-4"><a href={href("source", s.id)} className="underline underline-offset-4">{s.filename}</a></td>
                    <td className="py-2 pr-4"><span className="rounded-full bg-raised px-2 py-0.5 text-xs ">{t(`kinds.${s.kind}`)}</span></td>
                    <td className="py-2 pr-4 text-right tabular-nums">{size(s.sizeBytes)}</td>
                    <td className="hidden py-2 pr-4 sm:table-cell">{f.dateTime(s.createdAt, { dateStyle: "medium" })}</td>
                    <td className="py-2 pr-4 text-muted" data-testid="source-text">
                      {s.kind === "image" ? t("imageNote")
                        : s.status === "extracted" && s.textChars != null ? t("textChars", { n: f.number(s.textChars) })
                        : s.status === "failed" ? (t.has(`failReasons.${s.error}`) ? t(`failReasons.${s.error as "NO_TEXT"}`) : t("statuses.failed"))
                        : t(`statuses.${s.status}`)}
                    </td>
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
