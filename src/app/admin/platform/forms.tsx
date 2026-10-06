"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { updatePresetAction, updateRuleAction, type PlatformActionState } from "./actions";

const input = "rounded-lg border border-muted bg-raised px-3 py-2 text-fg outline-none focus:border-signal";
const button = "rounded-lg bg-signal px-4 py-2 font-semibold text-ink disabled:opacity-60";
const v = (n: number | null) => (n === null ? "" : String(n));

function Feedback({ state }: { state: PlatformActionState }) {
  const t = useTranslations("Admin.edit");
  if (state?.error) return <p role="alert" className="text-sm">{t(`errors.${state.error}`)}</p>;
  if (state?.ok) return <p role="status" className="text-sm">{t(`ok.${state.ok}`)}</p>;
  return null;
}

function Num({ name, label, value, min = 0, required = false }: { name: string; label: string; value: number | null; min?: number; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium">{label}</label>
      <input id={name} name={name} type="number" inputMode="numeric" min={min} step={1} required={required} defaultValue={v(value)} className={input} />
    </div>
  );
}

function Provenance({ source, confidence, notes, verifiedAt, today }: { source: string; confidence: string; notes: string | null; verifiedAt: string; today: string }) {
  const t = useTranslations("Admin");
  return (
    <fieldset className="grid gap-4 sm:col-span-2">
      <legend className="mb-2 text-sm font-semibold">{t("edit.provenance")}</legend>
      <div className="flex flex-col gap-1">
        <label htmlFor="source" className="text-sm font-medium">{t("edit.source")}</label>
        <input id="source" name="source" required minLength={3} maxLength={500} defaultValue={source} className={input} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="confidence" className="text-sm font-medium">{t("confidence")}</label>
          <select id="confidence" name="confidence" defaultValue={confidence} className={input}>
            {(["high", "medium", "low"] as const).map((c) => <option key={c} value={c}>{t(`conf.${c}`)}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="verifiedAt" className="text-sm font-medium">{t("edit.verifiedAt")}</label>
          <input id="verifiedAt" name="verifiedAt" type="date" required max={today} defaultValue={verifiedAt} className={input} />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="notes" className="text-sm font-medium">{t("edit.notes")}</label>
        <textarea id="notes" name="notes" rows={3} maxLength={2000} defaultValue={notes ?? ""} className={input} />
      </div>
    </fieldset>
  );
}

type Rule = {
  platform: string; counting: string; captionMax: number | null; visibleChars: number | null; hashtagsMax: number | null;
  mentionsMax: number | null; linksClickable: boolean; threadPartMax: number | null; threadPartsMax: number | null;
  slidesMin: number | null; slidesMax: number | null; source: string; confidence: string; notes: string | null; verifiedAt: string;
};

export function RuleForm({ rule, today }: { rule: Rule; today: string }) {
  const t = useTranslations("Admin");
  const [state, action, pending] = useActionState(updateRuleAction, undefined);
  return (
    <form action={action} className="grid max-w-2xl gap-4 sm:grid-cols-2">
      <input type="hidden" name="platform" value={rule.platform} />
      <p className="text-sm text-muted sm:col-span-2">{t("edit.emptyMeansNone")}</p>
      <div className="flex flex-col gap-1">
        <label htmlFor="counting" className="text-sm font-medium">{t("edit.counting")}</label>
        <select id="counting" name="counting" defaultValue={rule.counting} className={input}>
          <option value="graphemes">{t("edit.countings.graphemes")}</option>
          <option value="x_weighted">{t("edit.countings.x_weighted")}</option>
        </select>
      </div>
      <Num name="captionMax" label={t("edit.captionMax")} value={rule.captionMax} min={1} />
      <Num name="visibleChars" label={t("visibleChars")} value={rule.visibleChars} min={1} />
      <Num name="hashtagsMax" label={t("edit.hashtagsMax")} value={rule.hashtagsMax} />
      <Num name="mentionsMax" label={t("edit.mentionsMax")} value={rule.mentionsMax} />
      <Num name="threadPartMax" label={t("edit.threadPartMax")} value={rule.threadPartMax} min={1} />
      <Num name="threadPartsMax" label={t("edit.threadPartsMax")} value={rule.threadPartsMax} min={1} />
      <Num name="slidesMin" label={t("edit.slidesMin")} value={rule.slidesMin} min={1} />
      <Num name="slidesMax" label={t("edit.slidesMax")} value={rule.slidesMax} min={1} />
      <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2">
        <input type="checkbox" name="linksClickable" defaultChecked={rule.linksClickable} /> {t("links")}
      </label>
      <Provenance source={rule.source} confidence={rule.confidence} notes={rule.notes} verifiedAt={rule.verifiedAt} today={today} />
      <div className="flex items-center gap-4 sm:col-span-2">
        <button type="submit" disabled={pending} className={button}>{t("save")}</button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

type Preset = {
  key: string; media: string; width: number; height: number; maxBytes: number | null; minDurationS: number | null; maxDurationS: number | null;
  safeZone: { top: number; right: number; bottom: number; left: number }; enabled: boolean;
  source: string; confidence: string; notes: string | null; verifiedAt: string;
};

export function PresetForm({ preset, today }: { preset: Preset; today: string }) {
  const t = useTranslations("Admin");
  const [state, action, pending] = useActionState(updatePresetAction, undefined);
  const video = preset.media === "video";
  return (
    <form action={action} className="grid max-w-2xl gap-4 sm:grid-cols-2">
      <input type="hidden" name="key" value={preset.key} />
      <Num name="width" label={t("edit.width")} value={preset.width} min={1} required />
      <Num name="height" label={t("edit.height")} value={preset.height} min={1} required />
      <Num name="maxBytes" label={t("edit.maxBytes")} value={preset.maxBytes} min={1} />
      {video ? (
        <>
          <Num name="minDurationS" label={t("edit.minDurationS")} value={preset.minDurationS} />
          <Num name="maxDurationS" label={t("edit.maxDurationS")} value={preset.maxDurationS} min={1} />
        </>
      ) : (
        <>
          <input type="hidden" name="minDurationS" value={v(preset.minDurationS)} />
          <input type="hidden" name="maxDurationS" value={v(preset.maxDurationS)} />
        </>
      )}
      <fieldset className="grid grid-cols-2 gap-4 sm:col-span-2 sm:grid-cols-4">
        <legend className="mb-2 text-sm font-semibold">{t("edit.safeZone")}</legend>
        <Num name="safeTop" label={t("edit.top")} value={preset.safeZone.top} required />
        <Num name="safeRight" label={t("edit.right")} value={preset.safeZone.right} required />
        <Num name="safeBottom" label={t("edit.bottom")} value={preset.safeZone.bottom} required />
        <Num name="safeLeft" label={t("edit.left")} value={preset.safeZone.left} required />
      </fieldset>
      <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2">
        <input type="checkbox" name="enabled" defaultChecked={preset.enabled} /> {t("edit.enabled")}
      </label>
      <Provenance source={preset.source} confidence={preset.confidence} notes={preset.notes} verifiedAt={preset.verifiedAt} today={today} />
      <div className="flex items-center gap-4 sm:col-span-2">
        <button type="submit" disabled={pending} className={button}>{t("save")}</button>
        <Feedback state={state} />
      </div>
    </form>
  );
}
