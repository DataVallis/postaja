import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, buttonClass, Card, DataTable, EmptyState, PageHeader, selectClass, STATUS_TONE, td, Tabs } from "@/components/ui";
import { isIsoDate, startOfMonth, stepAnchor, todayIn, viewRange } from "@/lib/dates";
import { requireOrgPage } from "@/server/auth/require";
import { listBrands } from "@/server/brands/service";
import { getDb } from "@/server/db/client";
import { PLATFORMS } from "@/server/db/schema";
import { calendarPosts, historyPosts, unscheduledPosts, type PlanPost } from "@/server/posts/calendar";
import { bulkCandidates, listBulkRuns } from "@/server/bulk/service";
import { startBulkAction } from "./actions";
import { BulkRuns } from "./bulk-runs";

export const dynamic = "force-dynamic";

type View = "month" | "week" | "day";
type Search = Record<string, string | string[] | undefined>;

const SHORT: Record<string, string> = { instagram: "IG", facebook: "FB", linkedin: "IN", x: "X", tiktok: "TT", youtube: "YT", google_display: "GD" };
/** Status colour as a left bar on calendar chips (BRAND.md status colours). */
const BAR: Record<string, string> = {
  planned: "border-l-muted", generating: "border-l-muted", ready: "border-l-signal", needs_review: "border-l-warn",
  approved: "border-l-ok", published: "border-l-ok", skipped: "border-l-line", failed: "border-l-danger",
};

/** The plan of every brand (TASK-013): month, week and day views, posts without a slot, and the published history. */
export default async function PlanPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { org } = await requireOrgPage();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const today = todayIn();
  const view: View = one("view") === "week" || one("view") === "day" ? (one("view") as View) : "month";
  const anchor = isIsoDate(one("d")) ? one("d")! : today;
  const tab = one("tab") === "unscheduled" || one("tab") === "history" || one("tab") === "runs" ? one("tab")! : "calendar";
  const bulkError = one("bulkError");
  const f = { brandId: one("brand") || undefined, platform: one("platform") || undefined };
  const page = Math.max(1, Number(one("page")) || 1);

  const db = getDb();
  const range = viewRange(view, anchor);
  const [brandList, items, unscheduled, history, runs, dayTodo] = await Promise.all([
    listBrands(db, org),
    tab === "calendar" ? calendarPosts(db, org, range.from, range.to, f) : Promise.resolve([] as PlanPost[]),
    unscheduledPosts(db, org, f, tab === "unscheduled" ? 200 : 0),
    historyPosts(db, org, { ...f, page: tab === "history" ? page : 1 }),
    listBulkRuns(db, org),
    tab === "calendar" && view === "day" ? bulkCandidates(db, org, { kind: "day", date: anchor, brandId: f.brandId ?? null }) : Promise.resolve([] as string[]),
  ]);
  const tb = await getTranslations("Bulk");
  const activeRuns = runs.filter((r) => r.status === "queued" || r.status === "running").length;
  const t = await getTranslations("Plan");
  const tp = await getTranslations("Posts");
  const tf = await getTranslations("PostFormats");
  const fmt = await getFormatter();

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const all = { view, d: anchor, tab, brand: f.brandId, platform: f.platform, ...over };
    for (const [k, v] of Object.entries(all)) if (v && !(k === "view" && v === "month") && !(k === "tab" && v === "calendar") && !(k === "d" && v === today)) p.set(k, v);
    const s = p.toString();
    return `/app/plan${s ? `?${s}` : ""}`;
  };
  const day = (d: string, opts: { weekday?: "long" | "short"; day?: "numeric"; month?: "long" | "numeric"; year?: "numeric" }) => fmt.dateTime(new Date(`${d}T12:00:00Z`), { timeZone: "UTC", ...opts });
  const title =
    view === "month" ? day(startOfMonth(anchor), { month: "long", year: "numeric" })
    : view === "week" ? `${day(range.from, { day: "numeric", month: "numeric" })} – ${day(range.to, { day: "numeric", month: "numeric", year: "numeric" })}`
    : day(anchor, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const byDay = new Map<string, PlanPost[]>();
  for (const p of items) byDay.set(p.scheduledOn!, [...(byDay.get(p.scheduledOn!) ?? []), p]);
  const label = (p: PlanPost) => p.caption?.split("\n")[0] || p.topic || p.brief;
  const chip = (p: PlanPost) => (
    <Link key={p.id} href={`/app/posts/${p.id}`} title={`${p.brandName} · ${tp(`status.${p.status}`)}`}
      className={`block truncate rounded-md border-l-2 bg-raised/60 px-1.5 py-1 text-xs leading-tight hover:bg-raised ${BAR[p.status] ?? "border-l-line"}`}>
      <span className="text-muted">{p.scheduledTime ? `${p.scheduledTime} ` : ""}{p.platform ? `${SHORT[p.platform] ?? p.platform} · ` : ""}</span>
      {label(p)}
    </Link>
  );
  const postRows = (rows: PlanPost[], withDay: boolean) => rows.map((p) => (
    <tr key={p.id}>
      <td className={`${td} whitespace-nowrap text-muted`}>{withDay && p.scheduledOn ? `${day(p.scheduledOn, { weekday: "short", day: "numeric", month: "numeric" })} · ` : ""}{p.scheduledTime ?? (withDay ? "" : "—")}</td>
      <td className={`${td} min-w-56 max-w-lg`}><Link href={`/app/posts/${p.id}`} className="line-clamp-1 font-medium hover:underline">{label(p)}</Link></td>
      <td className={td}>{p.brandName}</td>
      <td className={`${td} whitespace-nowrap text-muted`}>{p.platform ? `${p.platform} · ${p.handle}` : "—"}</td>
      <td className={`${td} whitespace-nowrap`}>{tf(p.format)}</td>
      <td className={td}><Badge tone={STATUS_TONE[p.status]} dot>{tp(`status.${p.status}`)}</Badge></td>
    </tr>
  ));
  const weekdays = viewRange("week", "2026-10-05").days.map((d) => day(d, { weekday: "short" }));

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        {view !== "month" ? <input type="hidden" name="view" value={view} /> : null}
        {anchor !== today ? <input type="hidden" name="d" value={anchor} /> : null}
        {tab !== "calendar" ? <input type="hidden" name="tab" value={tab} /> : null}
        <label htmlFor="p-brand" className="sr-only">{tp("brand")}</label>
        <select id="p-brand" name="brand" defaultValue={f.brandId ?? ""} className={selectClass}>
          <option value="">{t("allBrands")}</option>
          {brandList.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <label htmlFor="p-platform" className="sr-only">{t("platform")}</label>
        <select id="p-platform" name="platform" defaultValue={f.platform ?? ""} className={selectClass}>
          <option value="">{t("allPlatforms")}</option>
          {PLATFORMS.filter((p) => p !== "google_display").map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button type="submit" className={buttonClass("secondary")}>{t("apply")}</button>
      </form>

      <Tabs
        label={t("tabsLabel")}
        defaultKey="calendar"
        tabs={[
          { key: "calendar", label: t("tabs.calendar"), href: qs({ tab: "calendar", page: undefined }) },
          { key: "unscheduled", label: t("tabs.unscheduled"), href: qs({ tab: "unscheduled" }), count: unscheduled.total },
          { key: "history", label: t("tabs.history"), href: qs({ tab: "history" }), count: history.total },
          { key: "runs", label: t("tabs.runs"), href: qs({ tab: "runs" }), count: activeRuns || undefined },
        ]}
      />
      {bulkError ? <p role="alert" className="mb-4 rounded-lg border border-danger/50 px-3 py-2 text-sm text-danger">{tb.has(`errors.${bulkError}`) ? tb(`errors.${bulkError}`) : tb("errors.FAILED")}</p> : null}

      {tab === "calendar" ? (
        <section aria-labelledby="cal-h" className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Link href={qs({ d: stepAnchor(view, anchor, -1) })} className={buttonClass("secondary", "sm")} aria-label={t("prev")}><ChevronLeft aria-hidden className="size-4" /></Link>
              <Link href={qs({ d: today })} className={buttonClass("secondary", "sm")}>{t("today")}</Link>
              <Link href={qs({ d: stepAnchor(view, anchor, 1) })} className={buttonClass("secondary", "sm")} aria-label={t("next")}><ChevronRight aria-hidden className="size-4" /></Link>
              <h2 id="cal-h" className="ml-2 text-lg font-semibold first-letter:uppercase" data-testid="plan-title">{title}</h2>
            </div>
            <nav aria-label={t("viewLabel")} className="inline-flex rounded-lg border border-line p-0.5">
              {(["month", "week", "day"] as const).map((v) => (
                <Link key={v} href={qs({ view: v })} aria-current={v === view ? "page" : undefined}
                  className={`rounded-md px-3 py-1 text-sm ${v === view ? "bg-raised font-medium text-fg" : "text-muted hover:text-fg"}`}>{t(`views.${v}`)}</Link>
              ))}
            </nav>
          </div>

          {view === "day" && dayTodo.length ? (
            <Card className="flex flex-wrap items-center justify-between gap-3 border-signal/40 p-4" data-testid="day-bulk">
              <div>
                <p className="font-semibold">{tb("dayTitle", { n: dayTodo.length })}</p>
                <p className="text-sm text-muted">{f.brandId ? tb("dayHintBrand") : tb("dayHint")}</p>
              </div>
              <form action={startBulkAction}>
                <input type="hidden" name="kind" value="day" />
                <input type="hidden" name="date" value={anchor} />
                {f.brandId ? <input type="hidden" name="brandId" value={f.brandId} /> : null}
                <input type="hidden" name="back" value={qs({})} />
                <button type="submit" className={buttonClass("primary")}>{tb("dayButton", { n: dayTodo.length })}</button>
              </form>
            </Card>
          ) : null}
          {view === "day" ? (
            <DataTable testId="plan-day" head={[t("time"), tp("post"), tp("brand"), tp("channel"), t("format"), t("status")]} empty={items.length ? undefined : t("emptyDay")}>
              {postRows(items, false)}
            </DataTable>
          ) : (
            <>
              {/* Grid on wider screens; an agenda list on phones. */}
              <Card className="hidden overflow-hidden md:block" data-testid="plan-grid">
                <div className="grid grid-cols-7 border-b border-line bg-raised/60 text-xs font-semibold uppercase tracking-wide text-muted">
                  {weekdays.map((w) => <div key={w} className="px-2 py-2">{w}</div>)}
                </div>
                <div className="grid grid-cols-7">
                  {range.days.map((d) => {
                    const list = byDay.get(d) ?? [];
                    const outside = view === "month" && d.slice(0, 7) !== anchor.slice(0, 7);
                    const max = view === "month" ? 4 : 50;
                    return (
                      <div key={d} data-day={d} className={`grid content-start gap-1 border-b border-r border-line p-1.5 [&:nth-child(7n)]:border-r-0 ${view === "month" ? "min-h-28" : "min-h-64"} ${outside ? "bg-bg/40" : ""}`}>
                        <Link href={qs({ view: "day", d })} className={`mb-0.5 inline-flex size-6 items-center justify-center justify-self-start rounded-full text-xs ${d === today ? "bg-signal font-semibold text-on-signal" : outside ? "text-muted" : "text-fg hover:bg-raised"}`} aria-label={day(d, { weekday: "long", day: "numeric", month: "long" })}>
                          {Number(d.slice(8))}
                        </Link>
                        {list.slice(0, max).map(chip)}
                        {list.length > max ? <Link href={qs({ view: "day", d })} className="px-1.5 text-xs text-muted hover:text-fg">{t("more", { n: list.length - max })}</Link> : null}
                      </div>
                    );
                  })}
                </div>
              </Card>
              <div className="grid gap-4 md:hidden" data-testid="plan-agenda">
                {range.days.filter((d) => byDay.has(d)).map((d) => (
                  <div key={d} className="grid gap-1.5">
                    <Link href={qs({ view: "day", d })} className="text-sm font-semibold first-letter:uppercase">{day(d, { weekday: "long", day: "numeric", month: "long" })}</Link>
                    {byDay.get(d)!.map(chip)}
                  </div>
                ))}
                {items.length ? null : <p className="text-sm text-muted">{t("emptyRange")}</p>}
              </div>
            </>
          )}
        </section>
      ) : null}

      {tab === "runs" ? <BulkRuns runs={runs} highlight={one("run")} /> : null}

      {tab === "unscheduled" ? (
        unscheduled.total ? (
          <DataTable testId="plan-unscheduled" head={[t("time"), tp("post"), tp("brand"), tp("channel"), t("format"), t("status")]}>
            {postRows(unscheduled.rows, false)}
          </DataTable>
        ) : <EmptyState title={t("noUnscheduled")} />
      ) : null}

      {tab === "history" ? (
        <>
          <DataTable testId="plan-history" head={[t("publishedOn"), tp("post"), tp("brand"), tp("channel"), t("format"), t("status")]} empty={history.total ? undefined : t("noHistory")}>
            {history.rows.map((p) => (
              <tr key={p.id}>
                <td className={`${td} whitespace-nowrap text-muted`}>{p.publishedAt ? fmt.dateTime(p.publishedAt, { dateStyle: "medium" }) : "—"}</td>
                <td className={`${td} min-w-56 max-w-lg`}><Link href={`/app/posts/${p.id}`} className="line-clamp-1 font-medium hover:underline">{label(p)}</Link></td>
                <td className={td}>{p.brandName}</td>
                <td className={`${td} whitespace-nowrap text-muted`}>{p.platform ? `${p.platform} · ${p.handle}` : "—"}</td>
                <td className={`${td} whitespace-nowrap`}>{tf(p.format)}</td>
                <td className={td}><Badge tone="ok" dot>{tp("status.published")}</Badge></td>
              </tr>
            ))}
          </DataTable>
          {history.pages > 1 ? (
            <nav aria-label={t("pagination")} className="mt-4 flex items-center justify-between text-sm text-muted">
              <span>{t("pageOf", { page: history.page, pages: history.pages })}</span>
              <span className="flex gap-2">
                {history.page > 1 ? <Link className={buttonClass("secondary", "sm")} href={qs({ page: String(history.page - 1) })}>←</Link> : null}
                {history.page < history.pages ? <Link className={buttonClass("secondary", "sm")} href={qs({ page: String(history.page + 1) })}>→</Link> : null}
              </span>
            </nav>
          ) : null}
        </>
      ) : null}
    </>
  );
}
