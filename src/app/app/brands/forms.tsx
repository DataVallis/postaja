"use client";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { addChannelAction, createBrandAction, saveProfileAction, type ActionState } from "./actions";

export const input = "rounded-lg border border-muted bg-bg px-3 py-2 text-fg outline-none focus:border-signal disabled:opacity-60";
const button = "rounded-lg bg-signal px-4 py-2 font-semibold text-ink disabled:opacity-60";
const LANGS = ["sl", "en", "de", "hr", "it"] as const;
const TYPES = ["text", "single_image", "carousel", "animation", "video", "ad"] as const;
const PLATFORMS = ["instagram", "facebook", "linkedin", "x", "tiktok", "youtube"] as const;

function Feedback({ state }: { state: ActionState }) {
  const t = useTranslations("Brands");
  if (state?.error) return <p role="alert" className="text-sm">{t(`errors.${state.error}`)}</p>;
  if (state?.ok) return <p role="status" className="text-sm">{state.ok.startsWith("v") ? t("savedVersion", { v: state.ok.slice(1) }) : t(`ok.${state.ok}`)}</p>;
  return null;
}

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children}
      {hint ? <span id={`${id}-hint`} className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

export function NewBrandForm() {
  const t = useTranslations("Brands");
  const [state, action, pending] = useActionState(createBrandAction, undefined);
  return (
    <form action={action} className="grid max-w-md gap-4">
      <Field id="name" label={t("name")}><input id="name" name="name" required minLength={2} className={input} /></Field>
      <Field id="slug" label={t("slug")}><input id="slug" name="slug" required pattern="[a-z0-9-]+" className={input} /></Field>
      <Field id="website" label={t("website")}><input id="website" name="website" type="url" placeholder="https://" className={input} /></Field>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 text-sm font-medium">{t("languages")}</legend>
        {LANGS.map((l) => (
          <label key={l} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="languages" value={l} defaultChecked={l === "sl"} /> {t(`lang.${l}`)}
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={pending} className={button}>{t("create")}</button>
      <Feedback state={state} />
    </form>
  );
}

type ProfileProps = {
  brandId: string;
  readOnly: boolean;
  cgp: string;
  pillarsText: string;
  rules: { bannedWords: string[]; ctaPhrases: string[]; captionMax?: number; hashtagsMax?: number; emojiMax?: number; linksAllowed?: boolean; mustEndWithCta?: boolean };
  visual: { colors: Record<string, string | undefined>; imageStyle: string; negativePrompt: string };
};

export function ProfileForm(p: ProfileProps) {
  const t = useTranslations("Brands");
  const [state, action, pending] = useActionState(saveProfileAction, undefined);
  const dis = p.readOnly || pending;
  return (
    <form action={action} className="grid gap-6">
      <input type="hidden" name="brandId" value={p.brandId} />
      <fieldset disabled={p.readOnly} className="grid gap-6">
        <Field id="cgp" label={t("cgp")} hint={t("cgpHint")}>
          <textarea id="cgp" name="cgp" rows={12} defaultValue={p.cgp} aria-describedby="cgp-hint" className={`${input} font-mono text-sm`} />
        </Field>
        <Field id="pillars" label={t("pillars")} hint={t("pillarsHint")}>
          <textarea id="pillars" name="pillars" rows={4} defaultValue={p.pillarsText} aria-describedby="pillars-hint" className={`${input} font-mono text-sm`} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="bannedWords" label={t("bannedWords")} hint={t("commaSeparated")}>
            <textarea id="bannedWords" name="bannedWords" rows={2} defaultValue={p.rules.bannedWords.join(", ")} aria-describedby="bannedWords-hint" className={input} />
          </Field>
          <Field id="ctaPhrases" label={t("ctaPhrases")} hint={t("onePerLine")}>
            <textarea id="ctaPhrases" name="ctaPhrases" rows={2} defaultValue={p.rules.ctaPhrases.join("\n")} aria-describedby="ctaPhrases-hint" className={input} />
          </Field>
          <Field id="hashtagsMax" label={t("hashtagsMax")}><input id="hashtagsMax" name="hashtagsMax" type="number" min={0} defaultValue={p.rules.hashtagsMax} className={input} /></Field>
          <Field id="emojiMax" label={t("emojiMax")}><input id="emojiMax" name="emojiMax" type="number" min={0} defaultValue={p.rules.emojiMax} className={input} /></Field>
          <Field id="captionMax" label={t("captionMax")}><input id="captionMax" name="captionMax" type="number" min={0} defaultValue={p.rules.captionMax} className={input} /></Field>
          <Field id="linksAllowed" label={t("linksAllowed")}>
            <select id="linksAllowed" name="linksAllowed" defaultValue={p.rules.linksAllowed === undefined ? "" : p.rules.linksAllowed ? "yes" : "no"} className={input}>
              <option value="">{t("platformDefault")}</option>
              <option value="yes">{t("yes")}</option>
              <option value="no">{t("no")}</option>
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="mustEndWithCta" defaultChecked={p.rules.mustEndWithCta} /> {t("mustEndWithCta")}
        </label>
        <div className="grid gap-4 sm:grid-cols-5">
          {(["primary", "secondary", "background", "text", "accent"] as const).map((c) => {
            const id = `color${c[0].toUpperCase()}${c.slice(1)}`;
            return (
              <Field key={c} id={id} label={t(`colors.${c}`)}>
                <input id={id} name={id} defaultValue={p.visual.colors[c] ?? ""} placeholder="#12172b" pattern="#[0-9a-fA-F]{6}" className={input} />
              </Field>
            );
          })}
        </div>
        <Field id="imageStyle" label={t("imageStyle")}><textarea id="imageStyle" name="imageStyle" rows={2} defaultValue={p.visual.imageStyle} className={input} /></Field>
        <Field id="negativePrompt" label={t("negativePrompt")}><textarea id="negativePrompt" name="negativePrompt" rows={2} defaultValue={p.visual.negativePrompt} className={input} /></Field>
        <Field id="note" label={t("note")}><input id="note" name="note" maxLength={200} className={input} /></Field>
      </fieldset>
      {p.readOnly ? <p className="text-sm text-muted">{t("readOnly")}</p> : <button type="submit" disabled={dis} className={button}>{t("saveVersion")}</button>}
      <Feedback state={state} />
    </form>
  );
}

export function ChannelForm({ brandId, languages, presets }: { brandId: string; languages: string[]; presets: { key: string; platform: string; width: number; height: number; media: string }[] }) {
  const t = useTranslations("Brands");
  const [state, action, pending] = useActionState(addChannelAction, undefined);
  const [platform, setPlatform] = useState<string>("instagram");
  return (
    <form action={action} className="grid gap-4 rounded-xl border border-muted/30 p-4">
      <input type="hidden" name="brandId" value={brandId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="platform" label={t("platform")}>
          <select id="platform" name="platform" value={platform} onChange={(e) => setPlatform(e.target.value)} className={input}>
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field id="handle" label={t("handle")}><input id="handle" name="handle" required className={input} /></Field>
        <Field id="language" label={t("language")}>
          <select id="language" name="language" defaultValue={languages[0]} className={input}>
            {LANGS.filter((l) => languages.includes(l)).map((l) => <option key={l} value={l}>{t(`lang.${l}`)}</option>)}
          </select>
        </Field>
        <Field id="postsPerDay" label={t("postsPerDay")}><input id="postsPerDay" name="postsPerDay" type="number" min={0} max={10} defaultValue={1} className={input} /></Field>
        <Field id="defaultPresetKey" label={t("defaultPreset")}>
          <select id="defaultPresetKey" name="defaultPresetKey" className={input} key={platform}>
            <option value="">—</option>
            {presets.filter((p) => p.platform === platform).map((p) => (
              <option key={p.key} value={p.key}>{p.key} · {p.width}×{p.height} {p.media}</option>
            ))}
          </select>
        </Field>
        <Field id="chHashtagsMax" label={t("chHashtagsMax")}><input id="chHashtagsMax" name="chHashtagsMax" type="number" min={0} className={input} /></Field>
      </div>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 text-sm font-medium">{t("weekdays")}</legend>
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <label key={d} className="flex items-center gap-1 text-sm">
            <input type="checkbox" name="weekdays" value={d} defaultChecked={d <= 5} /> {t(`days.${d}`)}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 text-sm font-medium">{t("allowedTypes")}</legend>
        {TYPES.map((ty) => (
          <label key={ty} className="flex items-center gap-1 text-sm">
            <input type="checkbox" name="allowedTypes" value={ty} defaultChecked={ty === "single_image" || ty === "carousel"} /> {t(`types.${ty}`)}
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={pending} className={button}>{t("addChannel")}</button>
      <Feedback state={state} />
    </form>
  );
}
