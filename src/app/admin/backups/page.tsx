import { getFormatter, getTranslations } from "next-intl/server";
import { requireSuperadmin } from "@/server/admin/guard";
import { backupConfigFromEnv, listBackups } from "@/server/backup/service";
import { runBackupNowAction } from "./actions";

export const dynamic = "force-dynamic";

const size = (b: number) => (b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Database backups (TASK-030, ADR-063): on in production only; the newest copies and a manual run. */
export default async function BackupsPage({ searchParams }: { searchParams: Promise<{ queued?: string; error?: string }> }) {
  await requireSuperadmin();
  const sp = await searchParams;
  const t = await getTranslations("Admin.backups");
  const f = await getFormatter();
  const cfg = backupConfigFromEnv();
  let list: Awaited<ReturnType<typeof listBackups>> = [];
  let listError = false;
  if (cfg) {
    try {
      list = await listBackups(cfg);
    } catch {
      listError = true;
    }
  }
  return (
    <div className="grid max-w-3xl gap-6">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("intro")}</p>
      </div>
      {!cfg ? <p className="rounded-lg border border-line p-4 text-sm" data-testid="backups-off">{t("off")}</p> : (
        <>
          <p className="text-sm" data-testid="backups-on">{t("on", { bucket: cfg.bucket, days: cfg.retentionDays })}</p>
          {sp.queued ? <p role="status" className="text-sm text-signal">{t("queued")}</p> : null}
          {listError ? <p role="alert" className="text-sm text-danger">{t("listError")}</p> : null}
          <form action={runBackupNowAction}><button type="submit" className="rounded-lg bg-signal px-4 py-2 font-semibold text-ink">{t("runNow")}</button></form>
          <table className="w-full text-left text-sm">
            <thead className="text-muted"><tr><th className="py-2 pr-4 font-medium">{t("when")}</th><th className="py-2 pr-4 font-medium">{t("file")}</th><th className="py-2 font-medium">{t("size")}</th></tr></thead>
            <tbody>
              {list.slice(0, 40).map((b) => (
                <tr key={b.key} className="border-t border-line"><td className="py-2 pr-4">{f.dateTime(b.at, { dateStyle: "medium", timeStyle: "short" })}</td><td className="py-2 pr-4 font-mono text-xs">{b.key}</td><td className="py-2">{size(b.bytes)}</td></tr>
              ))}
              {list.length === 0 && !listError ? <tr><td colSpan={3} className="py-3 text-muted">{t("none")}</td></tr> : null}
            </tbody>
          </table>
        </>
      )}
      {sp.error === "OFF" ? <p role="alert" className="text-sm text-danger">{t("off")}</p> : null}
    </div>
  );
}
