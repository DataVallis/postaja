import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClass, Card, DataTable, inputClass, PageHeader, selectClass, Stat, td } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { microToUsd } from "@/lib/money/usd";
import { requireOrgPage } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { listTeam, orgUsage } from "@/server/orgs/team";
import { creditStatus, orgCreditRequests } from "@/server/credits/service";
import { CREDIT_PACKS } from "@/server/db/schema";
import { cancelInvitationAction, inviteAction, removeMemberAction, requestCreditsAction, setRoleAction } from "./actions";

export const dynamic = "force-dynamic";

/** Team and plan (TASK-028): members, invitations, the plan's limits and this month's use. Owners change the team. */
export default async function TeamPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { org, user } = await requireOrgPage();
  const sp = await searchParams;
  const db = getDb();
  const [{ members, invites }, usage, credits, requests] = await Promise.all([listTeam(db, org), orgUsage(db, org), creditStatus(db, org.orgId), orgCreditRequests(db, org)]);
  const t = await getTranslations("Team");
  const f = await getFormatter();
  const isOwner = org.role === "owner";
  const of = (n: number | string, max?: number) => (max === undefined ? t("unlimited", { n: String(n) }) : t("of", { n: String(n), max }));
  return (
    <>
      <PageHeader title={t("title")} description={isOwner ? t("introOwner") : t("introEditor")} />
      {sp.ok ? <p role="status" className="mb-4 text-sm text-signal">{t(`ok.${sp.ok}` as "ok.invited")}</p> : null}
      {sp.error ? <p role="alert" className="mb-4 rounded-lg border border-danger/50 p-3 text-sm">{t.has(`errors.${sp.error}`) ? t(`errors.${sp.error}`) : t("errors.FAILED")}</p> : null}

      <section aria-labelledby="plan-h" className="mb-8 grid gap-3">
        <h2 id="plan-h" className="text-base font-semibold">{t("planTitle", { plan: t(`plans.${usage.plan}`) })}</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="team-usage">
          <Stat label={t("brands")} value={of(usage.brands, usage.limits.brands)} />
          <Stat label={t("members")} value={of(usage.members + usage.invites, usage.limits.members)} hint={usage.invites ? t("withInvites", { n: usage.invites }) : undefined} />
          <Stat label={t("generations")} value={of(usage.generations, usage.limits.generationsPerMonth)} hint={t("thisMonth")} />
          <Stat label={t("spend")} value={`${microToUsd(usage.spentMicroUsd)} €`} hint={t("ofCap", { cap: `${microToUsd(usage.capMicroUsd)} €` })} />
        </div>
        <p className="text-xs text-muted">{t("limitsHint")}</p>
      </section>

      <section aria-labelledby="credits-h" className="mb-8 grid gap-3" data-testid="team-credits">
        <h2 id="credits-h" className="text-base font-semibold">{t("credits.title")}</h2>
        {credits.allowance === null ? <p className="text-sm text-muted">{t("credits.unlimited", { used: credits.usedThisMonth })}</p> : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label={t("credits.month")} value={t("of", { n: String(credits.allowance - (credits.monthlyLeft ?? 0)), max: credits.allowance })} hint={t("thisMonth")} />
              <Stat label={t("credits.packs")} value={String(credits.packsLeft)} hint={credits.packs[0] ? t("credits.packsUntil", { at: f.dateTime(credits.packs[0].expiresAt, { dateStyle: "medium" }) }) : undefined} />
              <Stat label={t("credits.available")} value={String(credits.available ?? 0)} />
            </div>
            {credits.level !== "ok" ? <p role="status" className="rounded-lg border border-signal/50 p-3 text-sm">{t(`credits.${credits.level}`)}</p> : null}
          </>
        )}
        <p className="text-xs text-muted">{t("credits.hint")}</p>
        {isOwner ? (
          <form action={requestCreditsAction} className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{t("credits.buy")}</span>
            {(Object.keys(CREDIT_PACKS) as (keyof typeof CREDIT_PACKS)[]).map((k) => (
              <button key={k} type="submit" name="pack" value={k} className={buttonClass("secondary", "sm")}>
                {t("credits.packButton", { credits: CREDIT_PACKS[k].credits.toLocaleString("sl-SI"), price: CREDIT_PACKS[k].priceEur })}
              </button>
            ))}
          </form>
        ) : null}
        {requests.length ? (
          <ul className="grid gap-1 text-sm text-muted" data-testid="credit-request-list">
            {requests.map((r) => (
              <li key={r.id}>{t("credits.requestLine", { credits: CREDIT_PACKS[r.pack].credits.toLocaleString("sl-SI"), at: f.dateTime(r.createdAt, { dateStyle: "medium" }), status: t(`credits.statuses.${r.status}`) })}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="members-h" className="mb-8 grid gap-3">
        <h2 id="members-h" className="text-base font-semibold">{t("membersTitle")}</h2>
        <DataTable testId="team-members" head={[t("email"), t("role"), t("since"), ...(isOwner ? [t("actions")] : [])]}>
          {members.map((m) => (
            <tr key={m.id}>
              <td className={td}>{m.email}{m.userId === user.id ? <span className="ml-2 text-xs text-muted">({t("you")})</span> : null}</td>
              <td className={td}>
                {isOwner ? (
                  <form action={setRoleAction} className="flex items-center gap-2">
                    <input type="hidden" name="memberId" value={m.id} />
                    <label htmlFor={`role-${m.id}`} className="sr-only">{t("roleOf", { email: m.email })}</label>
                    <select id={`role-${m.id}`} name="role" defaultValue={m.role} className={`${selectClass} w-32`}>
                      <option value="owner">{t("roles.owner")}</option>
                      <option value="editor">{t("roles.editor")}</option>
                    </select>
                    <button type="submit" className={buttonClass("ghost", "sm")}>{t("change")}</button>
                  </form>
                ) : t(`roles.${m.role === "owner" ? "owner" : "editor"}`)}
              </td>
              <td className={td}>{f.dateTime(m.since, { dateStyle: "medium" })}</td>
              {isOwner ? (
                <td className={td}>
                  <details>
                    <summary className="cursor-pointer text-sm text-muted">{t("remove")}</summary>
                    <form action={removeMemberAction} className="mt-2">
                      <input type="hidden" name="memberId" value={m.id} />
                      <button type="submit" className={buttonClass("secondary", "sm")}>{t("removeConfirm", { email: m.email })}</button>
                    </form>
                  </details>
                </td>
              ) : null}
            </tr>
          ))}
        </DataTable>
      </section>

      {invites.length ? (
        <section aria-labelledby="invites-h" className="mb-8 grid gap-3">
          <h2 id="invites-h" className="text-base font-semibold">{t("invitesTitle")}</h2>
          <DataTable testId="team-invites" head={[t("email"), t("role"), t("validUntil"), ...(isOwner ? [t("actions")] : [])]}>
            {invites.map((i) => (
              <tr key={i.id}>
                <td className={td}>{i.email}</td>
                <td className={td}>{t(`roles.${i.role === "owner" ? "owner" : "editor"}`)}</td>
                <td className={td}>{f.dateTime(i.expiresAt, { dateStyle: "medium" })}</td>
                {isOwner ? (
                  <td className={td}>
                    <form action={cancelInvitationAction}>
                      <input type="hidden" name="invitationId" value={i.id} />
                      <button type="submit" className={buttonClass("ghost", "sm")}>{t("cancel")}</button>
                    </form>
                  </td>
                ) : null}
              </tr>
            ))}
          </DataTable>
        </section>
      ) : null}

      {isOwner ? (
        <Card className="grid gap-4 p-5" data-testid="team-invite">
          <div>
            <h2 className="text-base font-semibold">{t("inviteTitle")}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">{t("inviteHint")}</p>
          </div>
          <form action={inviteAction} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
            <div className="grid gap-1">
              <label htmlFor="invite-email" className="text-sm font-medium">{t("email")}</label>
              <input id="invite-email" name="email" type="email" required className={inputClass} />
            </div>
            <div className="grid gap-1">
              <label htmlFor="invite-role" className="text-sm font-medium">{t("role")}</label>
              <select id="invite-role" name="role" defaultValue="editor" className={selectClass}>
                <option value="editor">{t("roles.editor")}</option>
                <option value="owner">{t("roles.owner")}</option>
              </select>
            </div>
            <SubmitButton pending={t("inviting")}>{t("invite")}</SubmitButton>
          </form>
        </Card>
      ) : null}
    </>
  );
}
