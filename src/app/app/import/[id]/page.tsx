import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, buttonClass, Card, DataTable, inputClass, PageHeader, Section, selectClass, Stat, td } from "@/components/ui";
import { requireOrgPage } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { PLAN_FIELDS, PLAN_PLATFORMS, type ColumnMapping } from "@/server/plans/mapping";
import { groupKey, ImportError, importView } from "@/server/plans/service";
import type { PlanTable } from "@/server/plans/table";
import { discardImportAction, saveImportAction, saveMappingAction } from "../actions";

export const dynamic = "force-dynamic";

const SHOWN = 300;

export default async function ImportReview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { org } = await requireOrgPage();
  const { id } = await params;
  const { error } = await searchParams;
  const v = await importView(getDb(), org, id).catch((e) => {
    if (e instanceof ImportError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const t = await getTranslations("Import");
  const tp = await getTranslations("PostFormats");
  const f = await getFormatter();
  const r = v.import;
  const draft = r.status === "draft";
  const groupOf = new Map(v.groups.map((g) => [g.key, g]));
  const chan = new Map(v.channels.map((c) => [c.id, c]));
  const target = (i: (typeof v.items)[number]) => groupOf.get(groupKey(i))?.channelId ?? null;
  const importable = v.items.filter((i) => i.status !== "skip" && target(i) && target(i) !== "skip");
  const needsStart = v.items.some((i) => !i.date);
  const undated = v.items.some((i) => !i.date && i.dayOffset === null);
  const warnings = v.items.filter((i) => i.warnings.length).length;
  const day = (d: string | null) => (d ? f.dateTime(new Date(`${d}T12:00:00Z`), { weekday: "short", day: "numeric", month: "numeric", year: "numeric" }) : t("unscheduled"));
  const label = (key: string) => { const g = groupOf.get(key)!; return [g.platform ? t(`platforms.${g.platform}`) : t("noPlatform"), g.account].filter(Boolean).join(" · "); };

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/app/import" className="hover:text-fg hover:underline">{t("title")}</Link>}
        title={r.filename}
        description={r.reader.by === "ai" ? t("readByAi") : t("readByHeaders")}
        actions={<Badge tone={draft ? "warn" : r.status === "imported" ? "ok" : "neutral"} dot>{t(`status.${r.status}`)}</Badge>}
      />
      {error ? <p role="alert" className="mb-6 rounded-lg border border-danger/50 px-3 py-2 text-sm text-danger">{t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.FAILED")}</p> : null}
      {r.status === "imported" ? (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <span>{t("doneSummary", { n: r.createdCount })}</span>
          <Link href={`/app/posts?import=${r.id}`} className={buttonClass("primary", "sm")}>{t("seePosts")}</Link>
        </Card>
      ) : null}

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="import-stats">
        <Stat label={t("stats.items")} value={v.items.length} />
        <Stat label={t("stats.history")} value={v.items.filter((i) => i.status === "published").length} hint={t("stats.historyHint")} />
        <Stat label={t("stats.noText")} value={v.items.filter((i) => !i.text && i.status !== "skip").length} hint={t("stats.noTextHint")} />
        <Stat label={t("stats.warnings")} value={warnings} />
      </div>

      <div className="grid gap-8">
        {draft ? (
          <form action={saveImportAction} className="grid gap-6">
            <input type="hidden" name="importId" value={r.id} />
            <Section id="channels-h" title={t("channelsTitle")} description={t("channelsHint")}>
              <DataTable testId="import-groups" head={[t("platform"), t("account"), t("count"), t("channel")]}>
                {v.groups.map((g, gi) => (
                  <tr key={g.key}>
                    <td className={td}>{g.platform ? t(`platforms.${g.platform}`) : <span className="text-muted">{t("noPlatform")}</span>}</td>
                    <td className={td}>{g.account ?? <span className="text-muted">—</span>}</td>
                    <td className={`${td} tabular-nums`}>{g.count}</td>
                    <td className={td}>
                      <label htmlFor={`ch-${gi}`} className="sr-only">{t("channelFor", { what: label(g.key) })}</label>
                      <select id={`ch-${gi}`} name={`ch:${encodeURIComponent(g.key)}`} defaultValue={g.channelId ?? ""} className={`${selectClass} w-full min-w-56`}>
                        <option value="">{t("chooseChannel")}</option>
                        {v.channels.map((c) => <option key={c.id} value={c.id}>{c.brandName} · {t(`platforms.${c.platform}`)} · {c.handle}</option>)}
                        <option value="skip">{t("skipGroup")}</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </DataTable>
              {v.channels.length === 0 ? <p className="text-sm text-muted">{t("noChannels")} <Link href="/app/brands" className="underline underline-offset-4">{t("toBrands")}</Link></p> : null}
            </Section>

            {needsStart ? (
              <Section id="schedule-h" title={t("scheduleTitle")} description={undated ? t("scheduleHintUndated") : t("scheduleHint")}>
                <Card className="flex flex-wrap items-end gap-4 p-4">
                  <div className="grid gap-1">
                    <label htmlFor="startDate" className="text-sm font-medium">{t("startDate")}</label>
                    <input id="startDate" name="startDate" type="date" defaultValue={r.settings.startDate ?? ""} className={inputClass} />
                  </div>
                  {undated ? (
                    <div className="grid gap-1">
                      <label htmlFor="intervalDays" className="text-sm font-medium">{t("intervalDays")}</label>
                      <input id="intervalDays" name="intervalDays" type="number" min={1} max={60} defaultValue={r.settings.intervalDays ?? ""} className={`${inputClass} w-28`} />
                    </div>
                  ) : null}
                </Card>
              </Section>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" name="intent" value="confirm" disabled={!importable.length} className={buttonClass("primary")}>{t("confirm", { n: importable.length })}</button>
              <button type="submit" name="intent" value="save" className={buttonClass("secondary")}>{t("save")}</button>
              <span className="text-sm text-muted">{t("confirmHint")}</span>
            </div>
          </form>
        ) : null}

        <Section id="items-h" title={t("itemsTitle")} description={v.items.length > SHOWN ? t("itemsShown", { n: SHOWN, total: v.items.length }) : undefined}>
          <DataTable testId="import-items" head={[t("when"), t("channel"), t("format"), t("topic"), t("text"), t("statusCol"), t("warningsCol")]}>
            {v.items.slice(0, SHOWN).map((i, idx) => {
              const ch = target(i);
              const c = ch && ch !== "skip" ? chan.get(ch) : undefined;
              return (
                <tr key={i.ref + idx} className={i.status === "skip" || ch === "skip" ? "opacity-50" : undefined}>
                  <td className={`${td} whitespace-nowrap`}>{day(v.schedule[idx])}{i.time ? <span className="text-muted"> · {i.time}</span> : null}</td>
                  <td className={`${td} whitespace-nowrap`}>{c ? `${c.brandName} · ${c.handle}` : <span className="text-muted">{label(groupKey(i))}</span>}</td>
                  <td className={`${td} whitespace-nowrap`}>{tp(i.format)}{i.slideCount ? <span className="text-muted"> · {i.slideCount}</span> : null}</td>
                  <td className={`${td} min-w-32 max-w-48`}><span className="line-clamp-2">{i.topic ?? "—"}</span></td>
                  <td className={`${td} min-w-56 max-w-md`}><span className="line-clamp-2 whitespace-pre-line">{i.text ?? <span className="text-muted">{t("noTextYet")}</span>}</span></td>
                  <td className={td}><Badge tone={i.status === "published" ? "ok" : i.status === "skip" ? "neutral" : "signal"}>{t(`itemStatus.${i.status}`)}</Badge></td>
                  <td className={`${td} text-xs text-warn`}>{i.warnings.map((w) => { const [k, val] = w.split(/:(.*)/s); return t.has(`warnings.${k}`) ? t(`warnings.${k}`, { value: val ?? "" }) : w; }).join(" · ")}</td>
                </tr>
              );
            })}
          </DataTable>
        </Section>

        {draft && r.kind === "table" ? (
          <Section id="columns-h" title={t("columnsTitle")} description={t("columnsHint")}>
            <form action={saveMappingAction} className="grid gap-4">
              <input type="hidden" name="importId" value={r.id} />
              {((r.tables ?? []) as PlanTable[]).map((tb, s) => {
                const m = (r.mappings[s] ?? { columns: [] }) as ColumnMapping;
                return (
                  <Card key={s} className="grid gap-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="font-semibold">{t("sheet", { name: tb.sheet, rows: tb.rows.length })}</h3>
                      <div className="flex items-center gap-2 text-sm">
                        <label htmlFor={`platform-${s}`}>{t("defaultPlatform")}</label>
                        <select id={`platform-${s}`} name={`platform:${s}`} defaultValue={m.defaultPlatform ?? ""} className={selectClass}>
                          <option value="">—</option>
                          {PLAN_PLATFORMS.map((p) => <option key={p} value={p}>{t(`platforms.${p}`)}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {tb.header.map((h, i) => (
                        <div key={i} className="grid gap-1 rounded-lg border border-line p-2">
                          <label htmlFor={`col-${s}-${i}`} className="truncate text-sm font-medium" title={h}>{h || t("unnamedColumn", { n: i + 1 })}</label>
                          <span className="line-clamp-1 text-xs text-muted">{tb.rows.find((row) => row.cells[i])?.cells[i] ?? "—"}</span>
                          <select id={`col-${s}-${i}`} name={`col:${s}:${i}`} defaultValue={m.columns[i] ?? "ignore"} className={selectClass}>
                            {PLAN_FIELDS.map((fl) => <option key={fl} value={fl}>{t(`fields.${fl}`)}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  </Card>
                );
              })}
              <div><button type="submit" className={buttonClass("secondary")}>{t("rereadColumns")}</button></div>
            </form>
          </Section>
        ) : null}

        {draft ? (
          <form action={discardImportAction}>
            <input type="hidden" name="importId" value={r.id} />
            <button type="submit" className={buttonClass("danger", "sm")}>{t("discard")}</button>
          </form>
        ) : null}
      </div>
    </>
  );
}
