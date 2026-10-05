import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getRequestContext } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function AppHome() {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/login");
  const { user, org, orgError } = ctx;
  const t = await getTranslations("App");
  return (
    <main className="flex flex-col gap-4">
      <p>
        {t("signedInAs")} <strong data-testid="user-email">{user.email}</strong>
      </p>
      {user.role === "superadmin" ? (
        <p className="text-sm text-muted">
          {t("superadmin")} ·{" "}
          <Link href="/admin" className="underline underline-offset-4">
            {t("adminLink")}
          </Link>
        </p>
      ) : null}
      {org ? (
        <p data-testid="org">
          {t("organization")} <strong>{org.orgName}</strong> · {t(`roles.${org.role}`)} · {t(`plans.${org.plan}`)}
        </p>
      ) : (
        <p data-testid="no-org" className="text-muted">
          {orgError === "ORG_SUSPENDED" ? t("orgSuspended") : t("noOrg")}
        </p>
      )}
    </main>
  );
}
