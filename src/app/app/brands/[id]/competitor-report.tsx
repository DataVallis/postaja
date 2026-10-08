import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, buttonClass, Card } from "@/components/ui";
import type { competitorReports, Learning } from "@/server/db/schema";
import { decideLearningAction, sendLearningsAction } from "../competitor-actions";

type Report = typeof competitorReports.$inferSelect;

async function LearningRow({ l, reportId, brandId }: { l: Learning; reportId: string; brandId: string }) {
  const t = await getTranslations("Competitors");
  const pick = (d: "yes" | "no", label: string) => (
    <form action={decideLearningAction}>
      <input type="hidden" name="brandId" value={brandId} /><input type="hidden" name="reportId" value={reportId} />
      <input type="hidden" name="learningId" value={l.id} /><input type="hidden" name="decision" value={l.decision === d ? "" : d} />
      <button type="submit" aria-pressed={l.decision === d} aria-label={`${label}: ${l.title}`}
        className={`${buttonClass(l.decision === d ? "primary" : "secondary", "sm")}`}>{label}</button>
    </form>
  );
  return (
    <li className="grid gap-2 border-t border-line py-3 first:border-t-0" data-testid="learning">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid max-w-3xl gap-1">
          <p className="font-semibold">{l.title}</p>
          <p className="text-sm text-muted">{l.why}</p>
          {l.evidence.length ? (
            <p className="text-xs text-muted">{t("evidence")}: {l.evidence.map((e) => `${e.competitor} (${/^screenshot \d+$/i.test(e.source) ? t("screenshotN", { n: e.source.replace(/\D+/g, "") }) : e.source})`).join(" · ")}</p>
          ) : null}
        </div>
        <div className="flex gap-2">{pick("yes", t("yes"))}{pick("no", t("no"))}</div>
      </div>
    </li>
  );
}

/** One competitor analysis (TASK-050): summary, learnings to tick, gaps → ideas, the competitors' profiles. */
export async function CompetitorReport({ report, brandId, isOwner, older }: { report: Report; brandId: string; isOwner: boolean; older: { id: string; createdAt: Date }[] }) {
  const t = await getTranslations("Competitors");
  const f = await getFormatter();
  const adopt = report.learnings.filter((l) => l.kind === "adopt");
  const reject = report.learnings.filter((l) => l.kind === "reject");
  const accepted = report.learnings.filter((l) => l.decision === "yes").length;
  return (
    <Card className="grid gap-5 p-5" id="report" data-testid="competitor-report">
      <div>
        <h3 className="text-lg font-semibold">{t("reportTitle", { when: f.dateTime(report.createdAt, { dateStyle: "medium", timeStyle: "short" }) })}</h3>
        <p className="mt-2 max-w-3xl whitespace-pre-line text-sm">{report.summary}</p>
      </div>

      {[["adopt", adopt, t("adopt"), t("adoptHint")], ["reject", reject, t("reject"), t("rejectHint")]].map(([key, items, title, hint]) => (
        (items as Learning[]).length ? (
          <section key={key as string} className="grid gap-1" data-testid={`learnings-${key}`}>
            <h4 className="font-semibold">{title as string}</h4>
            <p className="text-xs text-muted">{hint as string}</p>
            <ul>{(items as Learning[]).map((l) => <LearningRow key={l.id} l={l} reportId={report.id} brandId={brandId} />)}</ul>
          </section>
        ) : null
      ))}

      {isOwner && report.learnings.length ? (
        <form action={sendLearningsAction} className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <input type="hidden" name="brandId" value={brandId} /><input type="hidden" name="reportId" value={report.id} />
          <button type="submit" disabled={!accepted} className={buttonClass("primary")}>{t("sendToCgp", { n: accepted })}</button>
          <span className="text-xs text-muted">{report.draftId ? <Badge tone="ok" dot>{t("sent")}</Badge> : null} {t("sendHint")}</span>
        </form>
      ) : null}

      {report.gaps.length ? (
        <section className="grid gap-2" data-testid="gaps">
          <h4 className="font-semibold">{t("gaps")}</h4>
          <ul className="grid gap-2">
            {report.gaps.map((g) => (
              <li key={g.topic} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line p-3 text-sm">
                <div className="grid max-w-3xl gap-1">
                  <p className="font-medium">{g.topic}</p>
                  <p className="text-muted">{g.why}{g.competitors.length ? ` (${g.competitors.join(", ")})` : ""}</p>
                </div>
                <Link href={`/app/brands/${brandId}?ideaHint=${encodeURIComponent(g.topic)}#ideas`} className={buttonClass("secondary", "sm")}>{t("ideasFromGap")}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.profiles.length ? (
        <details className="grid gap-2 border-t border-line pt-4" data-testid="profiles">
          <summary className="cursor-pointer font-semibold">{t("profiles", { n: report.profiles.length })}</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {report.profiles.map((p) => (
              <div key={p.name} className="grid gap-1 rounded-lg border border-line p-3 text-sm">
                <p className="font-semibold">{p.name}</p>
                {p.positioning ? <p>{p.positioning}</p> : null}
                {([["pillars", p.pillars], ["formats", p.formats], ["hooks", p.hooks], ["ctas", p.ctas], ["offers", p.offers]] as const).map(([k, v]) => (
                  v.length ? <p key={k} className="text-muted"><span className="font-medium text-fg">{t(`profile.${k}`)}:</span> {v.join(" · ")}</p> : null
                ))}
                {p.visual ? <p className="text-muted"><span className="font-medium text-fg">{t("profile.visual")}:</span> {p.visual}</p> : null}
                {p.tone ? <p className="text-muted"><span className="font-medium text-fg">{t("profile.tone")}:</span> {p.tone}</p> : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {older.length ? (
        <p className="border-t border-line pt-4 text-xs text-muted">
          {t("olderReports")}{" "}
          {older.map((o, i) => (
            <span key={o.id}>{i ? " · " : ""}<Link href={`/app/brands/${brandId}?tab=competitors&report=${o.id}#report`} className="underline underline-offset-4">{f.dateTime(o.createdAt, { dateStyle: "medium", timeStyle: "short" })}</Link></span>
          ))}
        </p>
      ) : null}
    </Card>
  );
}
