import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, buttonClass, DataTable, td } from "@/components/ui";
import type { BulkRunView } from "@/server/bulk/service";
import { cancelBulkAction } from "./actions";
import { AutoRefresh } from "./auto-refresh";

const TONE = { queued: "neutral", running: "signal", done: "ok", cancelled: "neutral" } as const;

/** Bulk runs with progress (TASK-014). Refreshes itself while any run is queued or running. */
export async function BulkRuns({ runs, highlight }: { runs: BulkRunView[]; highlight?: string }) {
  const t = await getTranslations("Bulk");
  const f = await getFormatter();
  const active = runs.some((r) => r.status === "queued" || r.status === "running");
  const scope = (r: BulkRunView) =>
    r.scope.kind === "day"
      ? t("scopeDay", { date: f.dateTime(new Date(`${r.scope.date}T12:00:00Z`), { timeZone: "UTC", weekday: "short", day: "numeric", month: "numeric" }) })
      : r.scope.to
        ? t("scopeRange", { from: f.dateTime(new Date(`${r.scope.from}T12:00:00Z`), { timeZone: "UTC", day: "numeric", month: "numeric" }), to: f.dateTime(new Date(`${r.scope.to}T12:00:00Z`), { timeZone: "UTC", day: "numeric", month: "numeric" }) })
        : t("scopeFrom", { from: f.dateTime(new Date(`${r.scope.from}T12:00:00Z`), { timeZone: "UTC", day: "numeric", month: "numeric" }) });
  return (
    <>
      <AutoRefresh active={active} />
      <DataTable testId="bulk-runs" head={[t("scope"), t("brand"), t("progress"), t("status"), t("started"), ""]} empty={runs.length ? undefined : t("none")}>
        {runs.map((r) => {
          const finished = r.counts.done + r.counts.failed + r.counts.skipped;
          const pct = r.total ? Math.round((finished / r.total) * 100) : 0;
          return (
            <tr key={r.id} className={r.id === highlight ? "bg-raised/40" : undefined} data-run={r.id}>
              <td className={`${td} whitespace-nowrap`}>{scope(r)}</td>
              <td className={td}>{r.brandName ?? t("allBrands")}</td>
              <td className={`${td} min-w-56`}>
                <div className="flex items-center gap-3">
                  <div className="h-2 w-32 overflow-hidden rounded-full bg-raised" role="progressbar" aria-label={t("progress")} aria-valuemin={0} aria-valuemax={r.total} aria-valuenow={finished}>
                    <div className="h-full rounded-full bg-signal transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="whitespace-nowrap text-xs tabular-nums text-muted" data-testid="run-counts">
                    {t("counts", { done: r.counts.done, total: r.total })}
                    {r.counts.failed ? ` · ${t("failed", { n: r.counts.failed })}` : ""}
                    {r.counts.skipped ? ` · ${t("skipped", { n: r.counts.skipped })}` : ""}
                  </span>
                </div>
              </td>
              <td className={td}><Badge tone={TONE[r.status]} dot>{t(`statuses.${r.status}`)}</Badge></td>
              <td className={`${td} whitespace-nowrap text-muted`}>{f.dateTime(r.createdAt, { dateStyle: "short", timeStyle: "short" })}</td>
              <td className={td}>
                {r.status === "queued" || r.status === "running" ? (
                  <form action={cancelBulkAction}>
                    <input type="hidden" name="runId" value={r.id} />
                    <button type="submit" className={buttonClass("ghost", "sm")}>{t("cancel")}</button>
                  </form>
                ) : null}
              </td>
            </tr>
          );
        })}
      </DataTable>
    </>
  );
}
