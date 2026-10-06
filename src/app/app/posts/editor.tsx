"use client";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { hashtags, measure, type RuleSet } from "@/lib/rules";
import { editPostAction, generatePostAction } from "./actions";

const input = "w-full rounded-lg border border-muted bg-raised px-3 py-2 text-fg outline-none focus:border-signal";
const primary = "rounded-lg bg-signal px-4 py-2 font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg disabled:opacity-60";

/** Live counter against the effective limit, computed with the same rule engine the server uses. */
function Counter({ text, rules, max }: { text: string; rules: RuleSet; max?: number }) {
  const t = useTranslations("Posts");
  const n = measure(text, rules.counting);
  const tags = hashtags(text).length;
  const over = max !== undefined && n > max;
  const tagsOver = rules.hashtagsMax !== undefined && tags > rules.hashtagsMax;
  return (
    <p className="flex gap-4 text-xs tabular-nums text-muted" aria-live="polite">
      <span className={over ? "font-semibold text-fg" : ""}>{t("chars", { n, max: max ?? "∞" })}{over ? ` — ${t("over")}` : ""}</span>
      <span className={tagsOver ? "font-semibold text-fg" : ""}>{t("tags", { n: tags, max: rules.hashtagsMax ?? "∞" })}</span>
    </p>
  );
}

export function PostEditor({ postId, caption, parts, rules, readOnly }: { postId: string; caption: string; parts?: string[]; rules: RuleSet; readOnly: boolean }) {
  const t = useTranslations("Posts");
  const [state, action, pending] = useActionState(editPostAction, undefined);
  const [text, setText] = useState(caption);
  const [list, setList] = useState(parts ?? []);
  const [copied, setCopied] = useState(false);
  const full = parts ? list.join("\n\n") : text;
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="postId" value={postId} />
      {parts ? (
        list.map((p, i) => (
          <div key={i} className="grid gap-1">
            <label htmlFor={`part-${i}`} className="text-sm font-medium">{t("part", { n: i + 1, of: list.length })}</label>
            <textarea id={`part-${i}`} name="part" rows={4} value={p} readOnly={readOnly} onChange={(e) => setList(list.map((x, j) => (j === i ? e.target.value : x)))} className={input} />
            <Counter text={p} rules={rules} max={rules.threadPartMax} />
          </div>
        ))
      ) : (
        <div className="grid gap-1">
          <label htmlFor="caption" className="text-sm font-medium">{t("text")}</label>
          <textarea id="caption" name="caption" rows={12} value={text} readOnly={readOnly} onChange={(e) => setText(e.target.value)} className={`${input} leading-relaxed`} />
          <Counter text={text} rules={rules} max={rules.captionMax} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {!readOnly ? <button type="submit" disabled={pending} className={primary}>{t("save")}</button> : null}
        <button
          type="button"
          onClick={async () => { await navigator.clipboard.writeText(full); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="h-9 rounded-lg border border-line px-4 text-sm font-medium hover:border-muted"
        >
          {copied ? t("copied") : t("copy")}
        </button>
        {state?.ok ? <p role="status" className="text-sm">{t(`ok.${state.ok}`)}</p> : null}
        {state?.error ? <p role="alert" className="text-sm">{t(`errors.${state.error}`)}</p> : null}
      </div>
    </form>
  );
}

export function NewPostForm({ brandId, channels }: { brandId: string; channels: { id: string; label: string }[] }) {
  const t = useTranslations("Posts");
  const [state, action, pending] = useActionState(generatePostAction, undefined);
  if (!channels.length) return <p className="text-sm text-muted">{t("noChannels")}</p>;
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="brandId" value={brandId} />
      <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_1fr]">
        <div className="grid content-start gap-1">
          <label htmlFor="channelId" className="text-sm font-medium">{t("channel")}</label>
          <select id="channelId" name="channelId" className={input}>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="brief" className="text-sm font-medium">{t("brief")}</label>
          <textarea id="brief" name="brief" rows={3} required minLength={3} maxLength={2000} placeholder={t("briefPlaceholder")} aria-describedby="brief-hint" className={input} />
          <span id="brief-hint" className="text-xs text-muted">{t("briefHint")}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={primary}>{pending ? t("generating") : t("generate")}</button>
        {pending ? <span className="text-sm text-muted" role="status">{t("generatingHint")}</span> : null}
        {state?.error ? <p role="alert" className="text-sm">{t(`errors.${state.error}`)}</p> : null}
      </div>
    </form>
  );
}
