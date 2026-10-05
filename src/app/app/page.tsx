import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getRequestContext } from "@/server/auth/session";
import { SignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";

export default async function AppHome() {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/login");
  const { user, org, orgError } = ctx;
  const t = await getTranslations("App");
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">
        postaja<span className="text-signal">.</span>
      </h1>
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
      <div>
        <SignOutButton />
      </div>
    </main>
  );
}
