import { getFormatter, getTranslations } from "next-intl/server";
import { MAX_BYTES } from "@/server/brands/files";
import type { listBrandFiles } from "@/server/brands/files";
import { deleteBrandFileAction } from "../actions";
import { UploadForm } from "../upload-form";

type Files = Awaited<ReturnType<typeof listBrandFiles>>;
const mb = (slot: keyof typeof MAX_BYTES) => MAX_BYTES[slot] / (1024 * 1024);
const size = (b: number) => (b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const href = (table: "source" | "asset", id: string) => `/api/brand-files/${table}/${id}`;

function Delete({ brandId, table, id, label }: { brandId: string; table: "source" | "asset"; id: string; label: string }) {
  return (
    <form action={deleteBrandFileAction}>
      <input type="hidden" name="brandId" value={brandId} />
      <input type="hidden" name="table" value={table} />
      <input type="hidden" name="fileId" value={id} />
      <button type="submit" aria-label={label} className="text-sm underline underline-offset-4">×</button>
    </form>
  );
}

/** Logos, fonts and brand sources of one brand (TASK-005b). Everyone in the org sees and downloads; owners upload/delete. */
export async function FilesSection({ brandId, files, isOwner, archived }: { brandId: string; files: Files; isOwner: boolean; archived: boolean }) {
  const t = await getTranslations("Brands.files");
  const f = await getFormatter();
  const canUpload = isOwner && !archived;
  return (
    <section aria-labelledby="files-h" className="grid gap-8">
      <div>
        <h2 id="files-h" className="text-lg font-semibold">{t("title")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("intro")}</p>
      </div>

      <div className="grid gap-3">
        <h3 className="font-semibold">{t("logos")}</h3>
        {files.logos.length === 0 ? <p className="text-sm text-muted">{t("noLogos")}</p> : null}
        <ul className="flex flex-wrap gap-4" data-testid="logos">
          {files.logos.map((l) => (
            <li key={l.id} className="grid gap-1 rounded-xl border border-muted/30 p-3 text-xs">
              {/* eslint-disable-next-line @next/next/no-img-element -- private presigned redirect, not optimisable */}
              <img src={href("asset", l.id)} alt={t("logoAlt", { name: l.filename })} className="h-16 w-auto max-w-48 object-contain" />
              <div className="flex items-center justify-between gap-2">
                <a href={href("asset", l.id)} className="underline underline-offset-4">{l.filename}</a>
                {isOwner ? <Delete brandId={brandId} table="asset" id={l.id} label={t("delete", { name: l.filename })} /> : null}
              </div>
            </li>
          ))}
        </ul>
        {canUpload ? <UploadForm brandId={brandId} slot="logo" maxMb={mb("logo")} /> : null}
      </div>

      <div className="grid gap-3">
        <h3 className="font-semibold">{t("fonts")}</h3>
        {files.fonts.length === 0 ? <p className="text-sm text-muted">{t("noFonts")}</p> : null}
        <ul className="grid gap-2 text-sm" data-testid="fonts">
          {files.fonts.map((ft) => (
            <li key={ft.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <strong>{ft.meta.family ?? ft.filename}</strong>
              <a href={href("asset", ft.id)} className="text-muted underline underline-offset-4">{ft.filename}</a>
              <span className="text-muted">
                {ft.meta.missingGlyphs?.length ? t("missingGlyphs", { chars: ft.meta.missingGlyphs.join(" ") }) : t("allGlyphs")}
              </span>
              {isOwner ? <Delete brandId={brandId} table="asset" id={ft.id} label={t("delete", { name: ft.filename })} /> : null}
            </li>
          ))}
        </ul>
        {canUpload ? <UploadForm brandId={brandId} slot="font" maxMb={mb("font")} /> : null}
      </div>

      <div className="grid gap-3">
        <h3 className="font-semibold">{t("sources")}</h3>
        {files.sources.length === 0 ? <p className="text-sm text-muted">{t("noSources")}</p> : null}
        {files.sources.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="sources">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">{t("file")}</th>
                  <th className="py-2 pr-4 font-medium">{t("kind")}</th>
                  <th className="py-2 pr-4 font-medium">{t("size")}</th>
                  <th className="py-2 pr-4 font-medium">{t("added")}</th>
                  <th className="py-2 pr-4 font-medium">{t("status")}</th>
                  {isOwner ? <th className="py-2 font-medium"><span className="sr-only">{t("actions")}</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {files.sources.map((s) => (
                  <tr key={s.id} className="border-t border-muted/20">
                    <td className="py-2 pr-4"><a href={href("source", s.id)} className="underline underline-offset-4">{s.filename}</a></td>
                    <td className="py-2 pr-4">{t(`kinds.${s.kind}`)}</td>
                    <td className="py-2 pr-4">{size(s.sizeBytes)}</td>
                    <td className="py-2 pr-4">{f.dateTime(s.createdAt, { dateStyle: "medium" })}</td>
                    <td className="py-2 pr-4">{t(`statuses.${s.status}`)}</td>
                    {isOwner ? <td className="py-2"><Delete brandId={brandId} table="source" id={s.id} label={t("delete", { name: s.filename })} /></td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {canUpload ? <UploadForm brandId={brandId} slot="source" maxMb={mb("source")} /> : null}
      </div>
    </section>
  );
}
