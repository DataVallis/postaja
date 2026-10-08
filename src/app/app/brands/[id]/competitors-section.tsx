import { ExternalLink, Search } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { AutoRefresh } from "@/app/app/plan/auto-refresh";
import { Badge, buttonClass, Card, inputClass, selectClass, textareaClass } from "@/components/ui";
import { COMPETITOR_PLATFORMS, type competitorRuns, type competitors } from "@/server/db/schema";
import { addCompetitorAction, findCompetitorsAction, keepCompetitorAction, removeCompetitorAction } from "../competitor-actions";

type Competitor = typeof competitors.$inferSelect;
type Run = typeof competitorRuns.$inferSelect;
const host = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

function Row({ c, brandId, canEdit }: { c: Competitor; brandId: string; canEdit: boolean }) {
  return (
    <li className="grid gap-2 border-t border-line py-3 first:border-t-0" data-testid="competitor">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <p className="font-semibold">{c.name}</p>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {c.website ? (
              <a href={c.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
                <ExternalLink aria-hidden className="size-3.5" />{host(c.website)}
              </a>
            ) : null}
            {c.handles.map((h) => (
              <a key={h.url} href={h.url} target="_blank" rel="noopener noreferrer" className="text-muted underline-offset-4 hover:text-fg hover:underline">{h.platform}</a>
            ))}
          </p>
          {c.reason ? <p className="max-w-3xl text-sm text-muted">{c.reason}</p> : null}
        </div>
        {canEdit ? <Actions c={c} brandId={brandId} /> : null}
      </div>
    </li>
  );
}

async function Actions({ c, brandId }: { c: Competitor; brandId: string }) {
  const t = await getTranslations("Competitors");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {c.status === "suggested" ? (
        <form action={keepCompetitorAction}>
          <input type="hidden" name="brandId" value={brandId} /><input type="hidden" name="id" value={c.id} />
          <button type="submit" className={buttonClass("secondary", "sm")} aria-label={t("keepName", { name: c.name })}>{t("keep")}</button>
        </form>
      ) : null}
      <form action={removeCompetitorAction}>
        <input type="hidden" name="brandId" value={brandId} /><input type="hidden" name="id" value={c.id} />
        <button type="submit" className={buttonClass("ghost", "sm")} aria-label={t("removeName", { name: c.name })}>{t("remove")}</button>
      </form>
    </div>
  );
}

/** Competitor research, step 1 (TASK-049): Claude finds competitors with web search; members keep, remove or add. */
export async function CompetitorsSection({ brandId, list, run, archived, error, maxCost }: { brandId: string; list: Competitor[]; run: Run | null; archived: boolean; error?: string; maxCost: string }) {
  const t = await getTranslations("Competitors");
  const f = await getFormatter();
  const working = run?.status === "queued" || run?.status === "running";
  const kept = list.filter((c) => c.status === "kept");
  const suggested = list.filter((c) => c.status === "suggested");
  const errText = (code: string) => (t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.FAILED"));
  const [runCode, ...runRest] = (run?.error ?? "").split(":");
  return (
    <section aria-labelledby="competitors-h" className="grid gap-6" data-testid="competitors">
      <AutoRefresh active={working} seconds={4} />
      <div>
        <h2 id="competitors-h" className="text-lg font-semibold">{t("title")}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("intro")}</p>
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{errText(error)}</p> : null}

      {!archived ? (
        <Card className="grid gap-3 p-5">
          <form action={findCompetitorsAction} className="grid gap-3" data-testid="find-competitors">
            <input type="hidden" name="brandId" value={brandId} />
            <label className="grid gap-1 text-sm">
              <span className="font-medium">{t("hintLabel")}</span>
              <textarea name="hint" rows={2} maxLength={1000} placeholder={t("hintPlaceholder")} className={textareaClass} />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={working} className={buttonClass("primary")}><Search aria-hidden className="size-4" />{working ? t("finding") : t("find")}</button>
              <span className="text-xs text-muted">{t("findHint", { cost: maxCost })}</span>
            </div>
          </form>
          {run ? (
            <p className="text-sm" data-testid="competitor-run">
              {working ? <Badge tone="signal" dot>{t("running")}</Badge> : run.status === "failed" ? (
                <span role="alert" className="text-danger">{errText(runCode)}{runRest.length ? <span className="mt-1 block text-xs text-muted">{runRest.join(":")}</span> : null}</span>
              ) : (
                <span className="text-muted">{t("lastRun", { when: f.dateTime(run.updatedAt, { dateStyle: "medium", timeStyle: "short" }), n: run.added })}</span>
              )}
            </p>
          ) : null}
        </Card>
      ) : null}

      {suggested.length ? (
        <Card className="grid gap-1 p-5" data-testid="competitors-suggested">
          <h3 className="font-semibold">{t("suggested", { n: suggested.length })}</h3>
          <p className="text-sm text-muted">{t("suggestedHint")}</p>
          <ul>{suggested.map((c) => <Row key={c.id} c={c} brandId={brandId} canEdit={!archived} />)}</ul>
        </Card>
      ) : null}

      <Card className="grid gap-1 p-5" data-testid="competitors-kept">
        <h3 className="font-semibold">{t("kept", { n: kept.length })}</h3>
        {kept.length ? <ul>{kept.map((c) => <Row key={c.id} c={c} brandId={brandId} canEdit={!archived} />)}</ul> : <p className="text-sm text-muted">{t("noneKept")}</p>}
      </Card>

      {!archived ? (
        <Card className="p-5">
          <form action={addCompetitorAction} className="grid gap-3" data-testid="add-competitor">
            <input type="hidden" name="brandId" value={brandId} />
            <h3 className="font-semibold">{t("addTitle")}</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm"><span>{t("name")}</span><input name="name" required maxLength={120} className={inputClass} /></label>
              <label className="grid gap-1 text-sm"><span>{t("website")}</span><input name="website" type="text" inputMode="url" maxLength={500} placeholder="https://…" className={inputClass} /></label>
              <label className="grid gap-1 text-sm">
                <span>{t("profilePlatform")}</span>
                <select name="platform" defaultValue="" className={selectClass}>
                  <option value="">—</option>
                  {COMPETITOR_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm"><span>{t("profileUrl")}</span><input name="profile" type="text" inputMode="url" maxLength={500} placeholder="https://instagram.com/…" className={inputClass} /></label>
            </div>
            <label className="grid gap-1 text-sm"><span>{t("note")}</span><input name="reason" maxLength={600} className={inputClass} /></label>
            <div><button type="submit" className={buttonClass("secondary")}>{t("add")}</button></div>
          </form>
        </Card>
      ) : null}
    </section>
  );
}
