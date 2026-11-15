"use client";
import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { signupAction } from "./actions";

const input = "rounded-lg border border-muted bg-raised px-3 py-2 text-fg outline-none focus:border-signal";

export function SignupForm() {
  const t = useTranslations("Signup");
  const [state, action, pending] = useActionState(signupAction, undefined);
  if (state?.sent) return <p role="status" className="rounded-lg bg-paper px-4 py-3 text-ink" data-testid="signup-sent">{t("sent")}</p>;
  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="orgName" className="text-sm font-medium">{t("orgName")}</label>
      <input id="orgName" name="orgName" required minLength={2} maxLength={80} autoComplete="organization" className={input} />
      <label htmlFor="email" className="text-sm font-medium">{t("email")}</label>
      <input id="email" name="email" type="email" required autoComplete="email" className={input} />
      <label className="mt-1 flex items-start gap-2 text-sm">
        <input type="checkbox" name="business" value="1" required className="mt-1" />
        <span>{t.rich("business", { terms: (c) => <Link href="/terms" target="_blank" className="font-semibold underline underline-offset-4">{c}</Link> })}</span>
      </label>
      {/* Hidden from people; bots fill it. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <button type="submit" disabled={pending} className="rounded-lg bg-signal px-4 py-2 font-semibold text-ink disabled:opacity-60">
        {pending ? t("sending") : t("submit")}
      </button>
      {state?.error ? <p role="alert" className="text-sm">{t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : t("errors.FAILED")}</p> : null}
    </form>
  );
}
