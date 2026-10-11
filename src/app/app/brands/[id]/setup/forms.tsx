"use client";
import { useActionState, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { buttonClass, inputClass, selectClass, textareaClass } from "@/components/ui";
import type { BrandRules, BrandVisual, Pillar } from "@/server/db/schema";
import { CgpImport } from "../../cgp-import";
import { CgpDraftBanner } from "../../forms";
import { saveSetupPartAction, type SetupState } from "./actions";

function Hidden({ brandId, part, next }: { brandId: string; part: string; next: string }) {
  return (<><input type="hidden" name="brandId" value={brandId} /><input type="hidden" name="part" value={part} /><input type="hidden" name="next" value={next} /></>);
}

function Footer({ pending, state, prevHref }: { pending: boolean; state: SetupState; prevHref: string | null }) {
  const t = useTranslations("Setup");
  return (
    <div className="grid gap-2">
      {state?.error ? <p role="alert" className="text-sm text-danger">{t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : t("errors.failed")}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {prevHref ? <a href={prevHref} className={buttonClass("ghost")}>{t("back")}</a> : null}
        <button type="submit" disabled={pending} className={buttonClass("primary")}>{pending ? t("saving") : t("saveNext")}</button>
      </div>
    </div>
  );
}

/** Step 1: the brand's communication guide — typed, pasted, read from a document, or sent by Claude. */
export function CgpStep(p: { brandId: string; cgp: string; min: number; next: string; prevHref: string | null; sources: { id: string; filename: string }[]; draft: { id: string; text: string; note: string | null; when: string } | null }) {
  const t = useTranslations("Setup");
  const [state, action, pending] = useActionState(saveSetupPartAction, undefined);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [chars, setChars] = useState(p.cgp.trim().length);
  const put = (text: string) => { if (ref.current) { ref.current.value = text; setChars(text.trim().length); ref.current.focus(); } };
  return (
    <form action={action} className="grid gap-4" data-testid="setup-cgp">
      <Hidden brandId={p.brandId} part="cgp" next={p.next} />
      {p.draft ? <CgpDraftBanner draft={p.draft} onInsert={put} /> : null}
      <CgpImport brandId={p.brandId} sources={p.sources} onText={put} />
      <label htmlFor="setup-cgp-text" className="text-sm font-medium">{t("cgp.label")}</label>
      <textarea id="setup-cgp-text" ref={ref} name="cgp" rows={16} defaultValue={p.cgp} onChange={(e) => setChars(e.currentTarget.value.trim().length)} aria-describedby="setup-cgp-count" className={`${textareaClass} font-mono text-sm`} />
      <p id="setup-cgp-count" className={`text-xs ${chars >= p.min ? "text-ok" : "text-muted"}`}>{chars >= p.min ? t("cgp.enough", { n: chars }) : t("cgp.short", { n: chars, min: p.min })}</p>
      <Footer pending={pending} state={state} prevHref={p.prevHref} />
    </form>
  );
}

/** Step 4: content pillars (up to 5) and the rules every post follows. */
export function RulesStep(p: { brandId: string; pillars: Pillar[]; rules: BrandRules; next: string; prevHref: string | null }) {
  const t = useTranslations("Setup");
  const [state, action, pending] = useActionState(saveSetupPartAction, undefined);
  const rows = [0, 1, 2, 3, 4].map((i) => p.pillars[i] ?? null);
  return (
    <form action={action} className="grid gap-6" data-testid="setup-rules">
      <Hidden brandId={p.brandId} part="rules" next={p.next} />
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">{t("rules.pillars")}</legend>
        <p className="text-xs text-muted">{t("rules.pillarsHint")}</p>
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_6rem_2fr]">
            <label className="sr-only" htmlFor={`pillar${i}`}>{t("rules.pillarName", { n: i + 1 })}</label>
            <input id={`pillar${i}`} name={`pillar${i}`} defaultValue={r?.name ?? ""} maxLength={60} placeholder={t("rules.pillarNamePh", { n: i + 1 })} className={inputClass} />
            <label className="sr-only" htmlFor={`share${i}`}>{t("rules.pillarShare", { n: i + 1 })}</label>
            <input id={`share${i}`} name={`share${i}`} type="number" min={0} max={100} defaultValue={r?.share ?? ""} placeholder="%" className={inputClass} />
            <label className="sr-only" htmlFor={`pillarDesc${i}`}>{t("rules.pillarDesc", { n: i + 1 })}</label>
            <input id={`pillarDesc${i}`} name={`pillarDesc${i}`} defaultValue={r?.description ?? ""} maxLength={500} placeholder={t("rules.pillarDescPh")} className={inputClass} />
          </div>
        ))}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm"><span className="font-medium">{t("rules.cta")}</span><span className="text-xs text-muted">{t("rules.ctaHint")}</span>
          <textarea name="ctaPhrases" rows={3} defaultValue={p.rules.ctaPhrases.join("\n")} className={textareaClass} /></label>
        <label className="grid gap-1 text-sm"><span className="font-medium">{t("rules.banned")}</span><span className="text-xs text-muted">{t("rules.bannedHint")}</span>
          <textarea name="bannedWords" rows={3} defaultValue={p.rules.bannedWords.join(", ")} className={textareaClass} /></label>
        <label className="grid gap-1 text-sm"><span className="font-medium">{t("rules.hashtags")}</span>
          <input name="hashtagsMax" type="number" min={0} max={100} defaultValue={p.rules.hashtagsMax ?? ""} className={inputClass} /></label>
        <label className="grid gap-1 text-sm"><span className="font-medium">{t("rules.emoji")}</span>
          <input name="emojiMax" type="number" min={0} max={100} defaultValue={p.rules.emojiMax ?? ""} className={inputClass} /></label>
        <label className="grid gap-1 text-sm"><span className="font-medium">{t("rules.links")}</span>
          <select name="linksAllowed" defaultValue={p.rules.linksAllowed === undefined ? "" : p.rules.linksAllowed ? "yes" : "no"} className={selectClass}>
            <option value="">{t("rules.linksDefault")}</option><option value="yes">{t("rules.yes")}</option><option value="no">{t("rules.no")}</option>
          </select></label>
        <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="mustEndWithCta" defaultChecked={p.rules.mustEndWithCta} /> {t("rules.endWithCta")}</label>
      </div>
      <Footer pending={pending} state={state} prevHref={p.prevHref} />
    </form>
  );
}

const COLORS = ["primary", "secondary", "accent", "background", "text"] as const;

/** Step 5: brand colours, the look of illustrations, and what pictures must never show. */
export function VisualStep(p: { brandId: string; visual: BrandVisual; next: string; prevHref: string | null }) {
  const t = useTranslations("Setup");
  const [state, action, pending] = useActionState(saveSetupPartAction, undefined);
  return (
    <form action={action} className="grid gap-6" data-testid="setup-visual">
      <Hidden brandId={p.brandId} part="visual" next={p.next} />
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">{t("visual.colors")}</legend>
        <p className="text-xs text-muted">{t("visual.colorsHint")}</p>
        <div className="grid gap-3 sm:grid-cols-5">
          {COLORS.map((c) => {
            const id = `color${c[0].toUpperCase()}${c.slice(1)}`;
            return (
              <label key={c} className="grid gap-1 text-sm"><span>{t(`visual.${c}`)}</span>
                <input name={id} defaultValue={p.visual.colors[c] ?? ""} placeholder="#12172b" pattern="#[0-9a-fA-F]{6}" className={`${inputClass} font-mono`} /></label>
            );
          })}
        </div>
      </fieldset>
      <label className="grid gap-1 text-sm"><span className="font-medium">{t("visual.style")}</span><span className="text-xs text-muted">{t("visual.styleHint")}</span>
        <textarea name="imageStyle" rows={3} maxLength={1000} defaultValue={p.visual.imageStyle} className={textareaClass} /></label>
      <label className="grid gap-1 text-sm"><span className="font-medium">{t("visual.avoid")}</span><span className="text-xs text-muted">{t("visual.avoidHint")}</span>
        <textarea name="negativePrompt" rows={2} maxLength={1000} defaultValue={p.visual.negativePrompt} className={textareaClass} /></label>
      <Footer pending={pending} state={state} prevHref={p.prevHref} />
    </form>
  );
}
