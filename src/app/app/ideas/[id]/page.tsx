import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, buttonClass, Card, inputClass, PageHeader } from "@/components/ui";
import { requireOrgPage } from "@/server/auth/require";
import { getBrandDetail } from "@/server/brands/service";
import { getDb } from "@/server/db/client";
import { getIdeaRun, IdeaError } from "@/server/ideas/service";
import { acceptIdeasAction, discardIdeasAction } from "../actions";

export const dynamic = "force-dynamic";

/** Claude's ideas for a channel (TASK-019): tick what to keep, adjust the day, then they become planned posts. */
export default async function IdeasReview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { org } = await requireOrgPage();
  const { id } = await params;
  const { error } = await searchParams;
  const db = getDb();
  const run = await getIdeaRun(db, org, id).catch((e) => {
    if (e instanceof IdeaError) notFound();
    throw e;
  });
  const { brand, channels } = await getBrandDetail(db, org, run.brandId);
  const channel = channels.find((c) => c.id === run.channelId);
  const t = await getTranslations("Ideas");
  const tf = await getTranslations("PostFormats");
  const f = await getFormatter();
  const draft = run.status === "draft";
  const day = (d: string) => f.dateTime(new Date(`${d}T12:00:00Z`), { timeZone: "UTC", weekday: "short", day: "numeric", month: "numeric" });

  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/app/brands/${brand.id}?tab=posts`} className="hover:text-fg hover:underline">{brand.name}</Link>}
        title={t("reviewTitle")}
        description={`${channel ? `${channel.platform} · ${channel.handle}` : ""}${run.hint ? ` · ${run.hint}` : ""}`}
        actions={<Badge tone={draft ? "warn" : run.status === "accepted" ? "ok" : "neutral"} dot>{t(`status.${run.status}`)}</Badge>}
      />
      {error ? <p role="alert" className="mb-4 text-sm text-danger">{t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.FAILED")}</p> : null}
      {run.replaced ? <p className="mb-4 text-sm text-muted" data-testid="ideas-replaced">{t("replaced", { n: run.replaced })}</p> : null}
      {run.status === "accepted" ? <p className="mb-4 text-sm" role="status">{t("acceptedSummary", { n: run.createdCount })} <Link href={`/app/plan?brand=${brand.id}`} className="underline underline-offset-4">{t("toPlan")}</Link></p> : null}

      <form action={acceptIdeasAction} className="grid max-w-4xl gap-3">
        <input type="hidden" name="runId" value={run.id} />
        <input type="hidden" name="brandId" value={brand.id} />
        <ol className="grid gap-3" data-testid="ideas-list">
          {run.ideas.map((idea, i) => (
            <li key={i}>
              <Card className="grid gap-2 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-start">
                <input id={`pick-${i}`} type="checkbox" name="pick" value={i} defaultChecked={!idea.similar} disabled={!draft} className="mt-1 size-4" aria-describedby={`angle-${i}`} />
                <div className="grid gap-1">
                  <label htmlFor={`pick-${i}`} className="font-semibold">{idea.title}</label>
                  <p id={`angle-${i}`} className="text-sm text-muted">{idea.angle}</p>
                  <p className="flex flex-wrap gap-2 text-xs text-muted">
                    <Badge tone="neutral">{tf(idea.format)}</Badge>
                    {idea.pillar ? <Badge tone="neutral">{idea.pillar}</Badge> : null}
                  </p>
                  {idea.similar ? (
                    <p className="text-xs text-warn" data-testid="idea-similar">
                      {t("similar", { score: Math.round(idea.similar.score * 100) })}{" "}
                      <Link href={`/app/posts/${idea.similar.postId}`} className="underline underline-offset-4">{idea.similar.label}</Link>
                      {idea.similar.date ? ` (${day(idea.similar.date)})` : ""}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-1">
                  <label htmlFor={`date-${i}`} className="text-xs font-medium text-muted">{t("day")}</label>
                  <input id={`date-${i}`} name={`date-${i}`} type="date" defaultValue={idea.date ?? ""} disabled={!draft} className={inputClass} />
                </div>
              </Card>
            </li>
          ))}
        </ol>
        {draft ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={buttonClass("primary")}>{t("accept")}</button>
            <button type="submit" formAction={discardIdeasAction} formNoValidate className={buttonClass("secondary")}>{t("discard")}</button>
            <span className="text-sm text-muted">{t("acceptHint")}</span>
          </div>
        ) : null}
      </form>
    </>
  );
}
