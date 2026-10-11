import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, buttonClass, Card } from "@/components/ui";
import { requireSuperadmin } from "@/server/admin/guard";
import { getDb } from "@/server/db/client";
import { listDemos, SALES_ORG } from "@/server/demos/service";
import { AutoRefresh } from "@/app/app/plan/auto-refresh";
import { openDemoBrandAction, revokeDemoLinkAction } from "./actions";
import { DemoForm, NewLinkButton } from "./forms";

export const dynamic = "force-dynamic";

/** Demo from a website (TASK-040, ADR-070): new demos and the list with their status and share links. */
export default async function DemosPage() {
  const actor = await requireSuperadmin();
  const t = await getTranslations("Admin.demos");
  const f = await getFormatter();
  const list = await listDemos(getDb(), actor);
  const now = new Date();
  const busy = list.some((r) => r.demo.status === "queued" || r.demo.status === "running");
  const tone = { queued: "neutral", running: "signal", ready: "ok", failed: "danger" } as const;
  return (
    <div className="grid max-w-4xl gap-6">
      <AutoRefresh active={busy} seconds={5} />
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("intro", { org: SALES_ORG.name })}</p>
      </div>
      <Card className="p-5"><DemoForm /></Card>
      <div className="grid gap-3" data-testid="demo-list">
        {list.length === 0 ? <p className="text-sm text-muted">{t("none")}</p> : null}
        {list.map(({ demo: d, brandName }) => {
          const linkOk = !!d.expiresAt && !d.revokedAt && d.expiresAt > now;
          return (
            <Card key={d.id} className="grid gap-3 p-4 text-sm" data-testid="demo-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="grid gap-0.5">
                  <p className="font-semibold">{brandName || d.nameHint || d.url}</p>
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted underline-offset-4 hover:underline">{d.url}</a>
                </div>
                <Badge tone={tone[d.status]} dot>{d.status === "running" ? `${t("statuses.running")} · ${t(`steps.${d.step}`)}` : t(`statuses.${d.status}`)}</Badge>
              </div>
              {d.status === "failed" ? <p className="text-danger">{t.has(`failures.${d.error}`) ? t(`failures.${d.error}`) : t("failures.FAILED", { code: d.error ?? "" })}</p> : null}
              {d.warnings.length ? <p className="text-xs text-muted">{t("warnings", { list: d.warnings.join(", ") })}</p> : null}
              <p className="text-xs text-muted">
                {t("created", { at: f.dateTime(d.createdAt, { dateStyle: "medium", timeStyle: "short" }) })}
                {" · "}
                {linkOk ? t("linkUntil", { at: f.dateTime(d.expiresAt!, { dateStyle: "medium" }) }) : d.revokedAt ? t("linkRevoked") : t("linkExpired")}
                {d.lastViewedAt ? ` · ${t("viewed", { at: f.dateTime(d.lastViewedAt, { dateStyle: "medium", timeStyle: "short" }) })}` : ""}
              </p>
              <div className="flex flex-wrap items-start gap-2">
                {d.brandId ? (
                  <form action={openDemoBrandAction}><input type="hidden" name="id" value={d.id} /><button type="submit" className={buttonClass("secondary", "sm")}>{t("openBrand")}</button></form>
                ) : null}
                <NewLinkButton id={d.id} />
                {linkOk ? (
                  <form action={revokeDemoLinkAction}><input type="hidden" name="id" value={d.id} /><button type="submit" className={buttonClass("ghost", "sm")}>{t("revoke")}</button></form>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
