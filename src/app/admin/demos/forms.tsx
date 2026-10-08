"use client";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { buttonClass, inputClass, textareaClass } from "@/components/ui";
import { newDemoLinkAction, startDemoAction, type DemoState } from "./actions";

/** The share link, shown once with a copy button. */
function NewLink({ url }: { url: string }) {
  const t = useTranslations("Admin.demos");
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-2 rounded-lg border border-signal/50 p-3 text-sm" data-testid="demo-new-link">
      <p className="font-medium">{t("newLink")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input readOnly value={url} aria-label={t("newLink")} className={`${inputClass} min-w-0 flex-1 font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className={buttonClass("secondary", "sm")} onClick={async () => { await navigator.clipboard.writeText(url).catch(() => undefined); setCopied(true); }}>{copied ? t("copied") : t("copy")}</button>
      </div>
      <p className="text-xs text-muted">{t("newLinkHint")}</p>
    </div>
  );
}

function ErrorLine({ code }: { code?: string }) {
  const t = useTranslations("Admin.demos");
  return code ? <p role="alert" className="text-sm text-danger">{t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.FAILED")}</p> : null;
}

/** New demo: the prospect's website, optionally the brand name and the site's text pasted by hand. */
export function DemoForm() {
  const t = useTranslations("Admin.demos");
  const [state, action, pending] = useActionState<DemoState, FormData>(startDemoAction, {});
  return (
    <div className="grid gap-3">
      <form action={action} className="grid gap-3" data-testid="demo-form">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
          <label className="grid gap-1 text-sm"><span>{t("url")}</span><input name="url" required maxLength={500} placeholder="https://www.primer.si" className={inputClass} /></label>
          <label className="grid gap-1 text-sm"><span>{t("name")}</span><input name="name" maxLength={80} className={inputClass} /></label>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">{t("pasteSummary")}</summary>
          <label className="mt-2 grid gap-1"><span>{t("text")}</span><textarea name="text" rows={6} maxLength={20000} className={textareaClass} /></label>
          <p className="mt-1 text-xs text-muted">{t("textHint")}</p>
        </details>
        <div><button type="submit" disabled={pending} className={buttonClass("primary")}>{pending ? t("creating") : t("create")}</button></div>
      </form>
      <ErrorLine code={state.error} />
      {state.url ? <NewLink url={state.url} /> : null}
    </div>
  );
}

/** "Nova povezava" for one demo; the new link appears under the button. */
export function NewLinkButton({ id }: { id: string }) {
  const t = useTranslations("Admin.demos");
  const [state, action, pending] = useActionState<DemoState, FormData>(newDemoLinkAction, {});
  return (
    <div className="grid gap-2">
      <form action={action}><input type="hidden" name="id" value={id} /><button type="submit" disabled={pending} className={buttonClass("secondary", "sm")}>{t("newLinkButton")}</button></form>
      <ErrorLine code={state.error} />
      {state.url ? <NewLink url={state.url} /> : null}
    </div>
  );
}
