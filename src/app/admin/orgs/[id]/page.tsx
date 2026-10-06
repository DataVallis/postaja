import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { microToUsd } from "@/lib/money/usd";
import { requireSuperadmin } from "@/server/admin/guard";
import { getOrganizationDetail } from "@/server/admin/queries";
import { getDb } from "@/server/db/client";
import { InviteForm, SettingsForm } from "../../forms";

export default async function OrgPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperadmin();
  const { id } = await params;
  const detail = await getOrganizationDetail(getDb(), id);
  if (!detail) notFound();
  const { org, members, invites } = detail;
  const t = await getTranslations("Admin");
  const f = await getFormatter();
  return (
    <div className="grid gap-10">
      <div>
        <h1 className="text-2xl font-bold">{org.name}</h1>
        <p className="text-sm text-muted">/{org.slug} · {f.dateTime(org.createdAt, { dateStyle: "medium" })}</p>
      </div>
      <section aria-labelledby="settings-h">
        <h2 id="settings-h" className="mb-4 text-lg font-semibold">{t("settings")}</h2>
        <SettingsForm orgId={org.id} plan={org.plan} status={org.status} capUsd={microToUsd(org.spendCapMicroUsd)} />
      </section>
      <section aria-labelledby="members-h">
        <h2 id="members-h" className="mb-4 text-lg font-semibold">{t("members")}</h2>
        <ul className="mb-6 grid gap-1 text-sm" data-testid="members">
          {members.map((m) => (
            <li key={m.email}>{m.email} · {t(`roles.${m.role === "owner" ? "owner" : "editor"}`)}</li>
          ))}
          {invites.map((i) => (
            <li key={i.email} className="text-muted">
              {i.email} · {t(`roles.${i.role === "owner" ? "owner" : "editor"}`)} · {t("invitedUntil")} {f.dateTime(i.expiresAt, { dateStyle: "medium" })}
            </li>
          ))}
          {members.length + invites.length === 0 ? <li className="text-muted">{t("noMembers")}</li> : null}
        </ul>
        <InviteForm orgId={org.id} />
      </section>
    </div>
  );
}
