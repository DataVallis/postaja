import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/ui";
import type { AdCopyVariant } from "@/server/db/schema";
import { deleteCopyVersionAction, deleteCreativeVersionAction, restoreCopyVersionAction, restoreCreativeVersionAction } from "../actions";

/** A short line of a copy variant (its texts in order), for recognising a version. */
const preview = (v: AdCopyVariant | undefined) =>
  Object.values(v ?? {}).flatMap((net) => Object.values(net ?? {}).flatMap((x) => (Array.isArray(x) ? x : [x]))).join(" · ").slice(0, 220);

function Actions({ adSetId, versionId, restore, remove, t }: { adSetId: string; versionId: string; restore: (f: FormData) => Promise<void>; remove: (f: FormData) => Promise<void>; t: (k: string) => string }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <form action={restore}>
        <input type="hidden" name="adSetId" value={adSetId} /><input type="hidden" name="versionId" value={versionId} />
        <button type="submit" className={buttonClass("secondary", "sm")}>{t("restore")}</button>
      </form>
      <details className="text-sm">
        <summary className={`${buttonClass("ghost", "sm")} cursor-pointer list-none`}>{t("delete")}</summary>
        <form action={remove} className="mt-2 grid gap-2">
          <input type="hidden" name="adSetId" value={adSetId} /><input type="hidden" name="versionId" value={versionId} />
          <p className="max-w-xs text-xs text-muted">{t("deleteWarning")}</p>
          <button type="submit" className={buttonClass("secondary", "sm")}>{t("deleteConfirm")}</button>
        </form>
      </details>
    </div>
  );
}

/** Earlier copy of the ad set (TASK-034): kept whenever new copy replaced it; restore or delete. */
export async function CopyVersions({ adSetId, versions }: { adSetId: string; versions: { id: string; createdAt: Date; copy: AdCopyVariant[] }[] }) {
  const t = await getTranslations("AdVersions");
  const f = await getFormatter();
  if (!versions.length) return null;
  return (
    <details className="grid gap-3 rounded-xl border border-line p-4" data-testid="copy-versions">
      <summary className="cursor-pointer text-sm font-semibold">{t("copyTitle", { n: versions.length })}</summary>
      <ul className="mt-3 grid gap-3">
        {versions.map((v) => (
          <li key={v.id} className="grid gap-2 border-t border-line pt-3 text-sm" data-testid="copy-version">
            <p className="text-xs text-muted">{t("replaced", { when: f.dateTime(v.createdAt, { dateStyle: "medium", timeStyle: "short" }) })} · {t("variants", { n: v.copy.length })}</p>
            <p className="text-muted">{preview(v.copy[0])}</p>
            <Actions adSetId={adSetId} versionId={v.id} restore={restoreCopyVersionAction} remove={deleteCopyVersionAction} t={t} />
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Earlier creatives of the ad set (TASK-034). */
export async function CreativeVersions({ adSetId, versions }: { adSetId: string; versions: { id: string; createdAt: Date; creatives: { id: string; variant: number; placement: string; width: number; height: number }[] }[] }) {
  const t = await getTranslations("AdVersions");
  const f = await getFormatter();
  if (!versions.length) return null;
  return (
    <details className="grid gap-3 border-t border-line pt-4" data-testid="creative-versions">
      <summary className="cursor-pointer text-sm font-semibold">{t("creativesTitle", { n: versions.length })}</summary>
      <ul className="mt-3 grid gap-4">
        {versions.map((v) => (
          <li key={v.id} className="grid gap-2 rounded-lg border border-line p-3" data-testid="creative-version">
            <p className="text-xs text-muted">{f.dateTime(v.createdAt, { dateStyle: "medium", timeStyle: "short" })}</p>
            <div className="flex flex-wrap gap-2">
              {v.creatives.map((c) => (
                <a key={c.id} href={`/api/ad-media/${c.id}`} target="_blank" rel="noopener" className="block w-20 overflow-hidden rounded ring-1 ring-line">
                  {/* eslint-disable-next-line @next/next/no-img-element -- presigned S3 URL behind an access-checked redirect */}
                  <img src={`/api/ad-media/${c.id}`} alt={`${c.placement} ${c.variant + 1}`} width={c.width} height={c.height} loading="lazy" className="h-auto w-full" />
                </a>
              ))}
            </div>
            <Actions adSetId={adSetId} versionId={v.id} restore={restoreCreativeVersionAction} remove={deleteCreativeVersionAction} t={t} />
          </li>
        ))}
      </ul>
    </details>
  );
}
