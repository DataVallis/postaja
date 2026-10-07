import { eq } from "drizzle-orm";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClass, Card, DataTable, PageHeader, selectClass, td } from "@/components/ui";
import { microToUsd } from "@/lib/money/usd";
import { requireOrgPage } from "@/server/auth/require";
import { estimateBulk } from "@/server/bulk/estimate";
import { BULK_MAX, scopeSchema } from "@/server/bulk/service";
import { getDb } from "@/server/db/client";
import { brands, planImports } from "@/server/db/schema";
import { forOrg } from "@/server/tenancy/scoped";
import { startBulkAction } from "../../plan/actions";
import { scopeFrom, scopeQuery, stepsFrom, type ScopeFields } from "../../plan/scope";

export const dynamic = "force-dynamic";

const eur = (micro: bigint) => `${microToUsd(micro)} €`;

/**
 * Before a bulk run starts (owner, 2026-10-07): what will be made and what it will cost — expected and at most — against
 * what is left of this month's cap. Changing the steps or the range re-estimates; the start button runs exactly this.
 */
export default async function BulkPreview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { org } = await requireOrgPage();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const fields: ScopeFields = { kind: one("kind"), date: one("date"), brandId: one("brandId"), days: one("days"), importId: one("importId"), steps: one("steps") };
  const back = one("back")?.startsWith("/app/") ? one("back")! : "/app/plan";
  const t = await getTranslations("Bulk");
  const fmt = await getFormatter();
  const db = getDb();
  const parsed = scopeSchema.safeParse(scopeFrom(fields));
  if (!parsed.success) {
    return (
      <>
        <PageHeader title={t("previewTitle")} />
        <p role="alert" className="text-sm text-danger">{t("errors.INVALID")}</p>
      </>
    );
  }
  const scope = parsed.data;
  const steps = stepsFrom(fields.steps);
  const stepsKey = steps.join(",");
  const est = await estimateBulk(db, org, scope, steps);
  const brandName = scope.brandId ? ((await forOrg(db, org).select(brands, eq(brands.id, scope.brandId))) as { name: string }[])[0]?.name : undefined;
  const importName = scope.kind === "import" ? ((await forOrg(db, org).select(planImports, eq(planImports.id, scope.importId))) as { filename: string }[])[0]?.filename : undefined;
  const day = (d: string) => fmt.dateTime(new Date(`${d}T12:00:00Z`), { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
  const what =
    scope.kind === "import" ? t("previewImport", { file: importName ?? "?" })
    : scope.kind === "day" ? t("previewDay", { date: day(scope.date) })
    : scope.to ? t("previewRange", { from: day(scope.from), to: day(scope.to) }) : t("previewAll");
  const jobs = (steps.includes("text") ? est.text.posts : 0) + (steps.includes("image") ? est.image.posts : 0);
  const link = (over: Partial<ScopeFields>) => `/app/bulk/new?${scopeQuery(fields, over)}&back=${encodeURIComponent(back)}`;
  const stepLink = (s: string, label: string) => (
    <Link key={s} href={link({ steps: s })} aria-current={stepsKey === s ? "page" : undefined}
      className={`rounded-md px-3 py-1 text-sm ${stepsKey === s ? "bg-raised font-medium text-fg" : "text-muted hover:text-fg"}`}>{label}</Link>
  );

  return (
    <>
      <PageHeader
        eyebrow={<Link href={back} className="hover:text-fg hover:underline">{t("previewBack")}</Link>}
        title={t("previewTitle")}
        description={`${brandName ?? t("allBrandsCap")} · ${what}`}
      />
      <div className="grid max-w-3xl gap-6" data-testid="bulk-preview">
        <div className="flex flex-wrap items-center gap-3">
          <nav aria-label={t("stepsLabel")} className="inline-flex rounded-lg border border-line p-0.5">
            {stepLink("text", t("stepText"))}
            {stepLink("text,image", t("stepBoth"))}
            {stepLink("image", t("stepImage"))}
          </nav>
          {scope.kind === "brand" ? (
            <form method="get" className="flex items-center gap-2">
              {Object.entries({ ...fields, days: undefined }).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
              <input type="hidden" name="back" value={back} />
              <label htmlFor="bulk-days" className="sr-only">{t("range")}</label>
              <select id="bulk-days" name="days" defaultValue={fields.days ?? "7"} className={selectClass}>
                <option value="7">{t("next7")}</option>
                <option value="30">{t("next30")}</option>
                <option value="all">{t("allPlanned")}</option>
              </select>
              <button type="submit" className={buttonClass("secondary", "sm")}>{t("recalc")}</button>
            </form>
          ) : null}
        </div>

        <DataTable testId="bulk-estimate" head={[t("colWhat"), t("colCount"), t("colModel"), t("colExpected"), t("colMax")]}>
          {steps.includes("text") ? (
            <tr>
              <td className={td}>{t("rowText")}</td>
              <td className={`${td} tabular-nums`} data-testid="estimate-text-count">{t("nPosts", { n: est.text.posts })}</td>
              <td className={`${td} text-muted`}>{est.text.model ?? "—"}</td>
              <td className={`${td} whitespace-nowrap tabular-nums`}>≈ {eur(est.text.expected)}</td>
              <td className={`${td} whitespace-nowrap tabular-nums text-muted`}>{eur(est.text.max)}</td>
            </tr>
          ) : null}
          {steps.includes("image") ? (
            <tr>
              <td className={td}>{t("rowImages")}</td>
              <td className={`${td} tabular-nums`} data-testid="estimate-image-count">{t("nImages", { posts: est.image.posts, images: est.image.images, illustrations: est.image.illustrations })}</td>
              <td className={`${td} text-muted`}>{est.image.model ?? "—"}</td>
              <td className={`${td} whitespace-nowrap tabular-nums`}>≈ {eur(est.image.expected)}</td>
              <td className={`${td} whitespace-nowrap tabular-nums text-muted`}>{eur(est.image.max)}</td>
            </tr>
          ) : null}
          <tr className="font-semibold">
            <td className={td}>{t("rowTotal")}</td>
            <td className={td} />
            <td className={td} />
            <td className={`${td} whitespace-nowrap tabular-nums`} data-testid="estimate-expected">≈ {eur(est.expected)}</td>
            <td className={`${td} whitespace-nowrap tabular-nums`} data-testid="estimate-max">{eur(est.max)}</td>
          </tr>
        </DataTable>
        <p className="-mt-3 text-xs text-muted">{t("estimateHint")}</p>

        {est.image.noDesign ? <p className="text-sm text-warn" data-testid="no-design">{t("noDesign", { n: est.image.noDesign })}</p> : null}
        <Card className="grid gap-1 p-4 text-sm" data-testid="bulk-budget">
          {est.budget.cap === null ? <p>{t("budgetNone")}</p> : (
            <p>{t("budget", { spent: eur(est.budget.spent), cap: eur(est.budget.cap), left: eur(est.budget.left ?? 0n) })}</p>
          )}
          {est.overBudget ? <p role="alert" className="text-warn">{t("overBudget")}</p> : null}
        </Card>

        {jobs === 0 ? <p role="status" className="text-sm text-muted">{t("errors.NOTHING_TO_DO")}</p>
        : jobs > BULK_MAX ? <p role="alert" className="text-sm text-danger">{t("errors.TOO_MANY")}</p>
        : (
          <form action={startBulkAction} className="flex flex-wrap items-center gap-3">
            {Object.entries(fields).map(([k, v]) => (v && k !== "steps" ? <input key={k} type="hidden" name={k} value={v} /> : null))}
            <input type="hidden" name="steps" value={stepsKey} />
            <input type="hidden" name="back" value={back} />
            <button type="submit" className={buttonClass("primary")}>{t("start", { n: jobs, cost: eur(est.expected) })}</button>
            <Link href={back} className={buttonClass("secondary")}>{t("previewCancel")}</Link>
          </form>
        )}
      </div>
    </>
  );
}
