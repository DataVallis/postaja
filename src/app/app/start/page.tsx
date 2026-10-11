import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { buttonClass, Card, inputClass, PageHeader } from "@/components/ui";
import { getRequestContext } from "@/server/auth/session";
import { TRIAL } from "@/server/billing/catalog";
import { getDb } from "@/server/db/client";
import { pendingSignup } from "@/server/signup/service";
import { startTrialAction } from "./actions";

export const dynamic = "force-dynamic";

/** After the signup link (TASK-037): confirm the organization's name and start the trial. */
export default async function StartPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/login");
  if (ctx.org) redirect("/app");
  const req = await pendingSignup(getDb(), ctx.user.email);
  if (!req) redirect("/app");
  const t = await getTranslations("Signup");
  const { error } = await searchParams;
  return (
    <>
      <PageHeader title={t("startTitle")} description={t("startIntro", { days: TRIAL.days, brands: TRIAL.limits.brands, credits: TRIAL.limits.creditsPerMonth })} />
      <Card className="grid max-w-lg gap-4 p-6">
        {error ? <p role="alert" className="text-sm text-danger">{t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.FAILED")}</p> : null}
        <form action={startTrialAction} className="grid gap-3">
          <label htmlFor="start-org" className="text-sm font-medium">{t("orgName")}</label>
          <input id="start-org" name="orgName" required minLength={2} maxLength={80} defaultValue={req.orgName} className={inputClass} />
          <p className="text-xs text-muted">{t("noCard")}</p>
          <div><button type="submit" className={buttonClass("primary")}>{t("start", { days: TRIAL.days })}</button></div>
        </form>
      </Card>
    </>
  );
}
