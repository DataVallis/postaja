import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/session";
import { TRIAL } from "@/server/billing/catalog";
import { publicSignupEnabled } from "@/server/signup/service";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

/** Public signup for a free trial (TASK-037, ADR-085); only where PUBLIC_SIGNUP=1. */
export default async function SignupPage() {
  if (!publicSignupEnabled()) notFound();
  if (await getCurrentUser()) redirect("/app/start");
  const t = await getTranslations("Signup");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8">
        <h1 className="mb-2 flex items-center gap-2 text-3xl font-bold tracking-tight">
          <Image src="/mark.svg" alt="" width={32} height={32} />
          <span>postaja<span className="text-signal">.</span></span>
        </h1>
        <p className="mb-1 text-lg font-semibold">{t("title", { days: TRIAL.days })}</p>
        <p className="mb-6 text-sm text-muted">{t("intro", { brands: TRIAL.limits.brands, credits: TRIAL.limits.creditsPerMonth })}</p>
        <SignupForm />
        <p className="mt-6 text-sm text-muted">{t("haveAccount")} <Link href="/login" className="font-semibold underline underline-offset-4">{t("login")}</Link></p>
      </div>
    </main>
  );
}
