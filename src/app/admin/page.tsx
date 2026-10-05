import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { microToUsd } from "@/lib/money/usd";
import { requireSuperadmin } from "@/server/admin/guard";
import { listOrganizations } from "@/server/admin/queries";
import { getDb } from "@/server/db/client";
import { countDueForReverification } from "@/server/rules/repo";
import { ReverifyBanner } from "./reverify-banner";

export default async function AdminHome() {
  await requireSuperadmin();
  const t = await getTranslations("Admin");
  const [orgs, due] = await Promise.all([listOrganizations(getDb()), countDueForReverification(getDb())]);
  return (
    <main className="grid gap-6">
      <ReverifyBanner rules={due.rules} presets={due.presets} link />
      <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{t("organizations")}</h1>
        <Link href="/admin/orgs/new" className="rounded-lg bg-signal px-4 py-2 font-semibold text-ink">
          {t("newOrg")}
        </Link>
      </div>
      {orgs.length === 0 ? (
        <p className="text-muted">{t("noOrgs")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">{t("name")}</th>
                <th className="py-2 pr-4 font-medium">{t("plan")}</th>
                <th className="py-2 pr-4 font-medium">{t("status")}</th>
                <th className="py-2 pr-4 font-medium">{t("members")}</th>
                <th className="py-2 pr-4 font-medium">{t("pending")}</th>
                <th className="py-2 pr-4 font-medium">{t("cap")}</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} className="border-t border-muted/20">
                  <td className="py-2 pr-4">
                    <Link href={`/admin/orgs/${o.id}`} className="font-semibold underline-offset-4 hover:underline">
                      {o.name}
                    </Link>{" "}
                    <span className="text-muted">/{o.slug}</span>
                  </td>
                  <td className="py-2 pr-4">{t(`plans.${o.plan}`)}</td>
                  <td className="py-2 pr-4">{t(`statuses.${o.status}`)}</td>
                  <td className="py-2 pr-4">{o.members}</td>
                  <td className="py-2 pr-4">{o.pendingInvites}</td>
                  <td className="py-2 pr-4">${microToUsd(o.spendCapMicroUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </main>
  );
}
