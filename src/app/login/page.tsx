import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentUser()) redirect("/app");
  const t = await getTranslations("Login");
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-3xl font-bold tracking-tight">
          postaja<span className="text-signal">.</span>
        </h1>
        <p className="mb-6 text-muted">{t("intro")}</p>
        {error ? (
          <p role="alert" className="mb-4 rounded-lg border border-signal px-3 py-2 text-sm">
            {t("linkInvalid")}
          </p>
        ) : null}
        <LoginForm />
      </div>
    </main>
  );
}
