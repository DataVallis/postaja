import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/session";
import { SignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";

export default async function AppHome() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations("App");
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">
        postaja<span className="text-signal">.</span>
      </h1>
      <p>
        {t("signedInAs")} <strong data-testid="user-email">{user.email}</strong>
      </p>
      {user.role === "superadmin" ? <p className="text-sm text-muted">{t("superadmin")}</p> : null}
      <div>
        <SignOutButton />
      </div>
    </main>
  );
}
