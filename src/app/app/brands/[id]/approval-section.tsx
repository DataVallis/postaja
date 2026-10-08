import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, buttonClass, Card } from "@/components/ui";
import type { approvalLinks } from "@/server/db/schema";
import { revokeApprovalLinkAction } from "../approval-actions";
import { ApprovalLinkForm } from "../approval-form";

type Link = typeof approvalLinks.$inferSelect;

/** Client approval links of a brand (TASK-041): create one for a week, see which work, revoke. */
export async function ApprovalSection({ brandId, links, from, to, archived, now }: { brandId: string; links: Link[]; from: string; to: string; archived: boolean; now: number }) {
  const t = await getTranslations("ApprovalLinks");
  const f = await getFormatter();
  const day = (d: string) => f.dateTime(new Date(`${d}T12:00:00Z`), { dateStyle: "medium" });
  return (
    <Card className="grid gap-4 p-5" id="approval" data-testid="approval">
      <div>
        <h3 className="font-semibold">{t("title")}</h3>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("intro")}</p>
      </div>
      {!archived ? <ApprovalLinkForm brandId={brandId} from={from} to={to} /> : null}
      {links.length ? (
        <ul className="grid gap-2 text-sm" data-testid="approval-links">
          {links.map((l) => {
            const live = !l.revokedAt && l.expiresAt.getTime() > now;
            return (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
                <span className="grid gap-0.5">
                  <span className="font-medium">{l.label}</span>
                  <span className="text-xs text-muted">
                    {day(l.fromDate)} – {day(l.toDate)} · {l.lastViewedAt ? t("viewed", { when: f.dateTime(l.lastViewedAt, { dateStyle: "medium", timeStyle: "short" }) }) : t("notViewed")}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={live ? "ok" : "neutral"} dot>{l.revokedAt ? t("revoked") : live ? t("active", { until: f.dateTime(l.expiresAt, { dateStyle: "medium" }) }) : t("expired")}</Badge>
                  {live ? (
                    <form action={revokeApprovalLinkAction}>
                      <input type="hidden" name="brandId" value={brandId} /><input type="hidden" name="id" value={l.id} />
                      <button type="submit" className={buttonClass("ghost", "sm")} aria-label={t("revokeName", { name: l.label })}>{t("revoke")}</button>
                    </form>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}
