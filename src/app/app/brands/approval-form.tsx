"use client";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { buttonClass, inputClass } from "@/components/ui";
import { createApprovalLinkAction, type LinkState } from "./approval-actions";

/** New client link (TASK-041): who it is for and which days; the link is shown once with a copy button. */
export function ApprovalLinkForm({ brandId, from, to }: { brandId: string; from: string; to: string }) {
  const t = useTranslations("ApprovalLinks");
  const [state, action, pending] = useActionState<LinkState, FormData>(createApprovalLinkAction, {});
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-3">
      <form action={action} className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end" data-testid="approval-form">
        <input type="hidden" name="brandId" value={brandId} />
        <label className="grid gap-1 text-sm"><span>{t("label")}</span><input name="label" required maxLength={120} placeholder={t("labelPlaceholder")} className={inputClass} /></label>
        <label className="grid gap-1 text-sm"><span>{t("from")}</span><input name="from" type="date" required defaultValue={from} className={inputClass} /></label>
        <label className="grid gap-1 text-sm"><span>{t("to")}</span><input name="to" type="date" required defaultValue={to} className={inputClass} /></label>
        <button type="submit" disabled={pending} className={buttonClass("primary")}>{pending ? t("creating") : t("create")}</button>
      </form>
      {state.error ? <p role="alert" className="text-sm text-danger">{t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : t("errors.FAILED")}</p> : null}
      {state.url ? (
        <div className="grid gap-2 rounded-lg border border-signal/50 p-3 text-sm" data-testid="approval-new-link">
          <p className="font-medium">{t("newLink")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={state.url} aria-label={t("newLink")} className={`${inputClass} min-w-0 flex-1 font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className={buttonClass("secondary", "sm")} onClick={async () => { await navigator.clipboard.writeText(state.url!).catch(() => undefined); setCopied(true); }}>{copied ? t("copied") : t("copy")}</button>
          </div>
          <p className="text-xs text-muted">{t("newLinkHint")}</p>
        </div>
      ) : null}
    </div>
  );
}
