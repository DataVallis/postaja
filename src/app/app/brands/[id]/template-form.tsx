"use client";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { buttonClass, inputClass, selectClass, textareaClass } from "@/components/ui";
import type { BrandTemplate, Colors } from "@/server/images/template";
import { saveImageTemplateAction } from "../actions";

type Asset = { id: string; filename: string };

/**
 * Image template (TASK-015): how Postaja lays out the post images. The preview is rendered by the server with the
 * unsaved values (no image cost: a stand-in photo replaces the AI background).
 */
export function TemplateForm(props: { brandId: string; template: BrandTemplate; colors: Colors; logos: Asset[]; fonts: Asset[]; readOnly: boolean; sample: { text: string; label: string } }) {
  const t = useTranslations("Images");
  const tb = useTranslations("Brands");
  const [state, action, pending] = useActionState(saveImageTemplateAction, undefined);
  const [v, setV] = useState({
    ...props.template,
    logoId: props.template.logoId ?? "",
    fontId: props.template.fontId ?? "",
    bg: props.colors.background,
    fg: props.colors.text,
    accent: props.colors.accent,
  });
  const [shape, setShape] = useState<"portrait" | "square" | "landscape">("portrait");
  const [text, setText] = useState(props.sample.text);
  const set = <K extends keyof typeof v>(k: K) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  const query = useMemo(() => {
    const q = new URLSearchParams({
      layout: v.layout, background: v.background, label: v.label, accentLine: v.accentLine, uppercase: v.uppercase ? "1" : "0", typeface: v.typeface,
      overlay: String(v.overlay), footerText: v.footerText, logoId: v.logoId, fontId: v.fontId, bg: v.bg, fg: v.fg, accent: v.accent, shape, text, labelText: props.sample.label,
    });
    return q.toString();
  }, [v, shape, text, props.sample.label]);
  // Debounced: the preview follows typing without a request per keystroke.
  const [src, setSrc] = useState(`/api/brands/${props.brandId}/image-preview?${query}`);
  useEffect(() => {
    const h = setTimeout(() => setSrc(`/api/brands/${props.brandId}/image-preview?${query}`), 350);
    return () => clearTimeout(h);
  }, [query, props.brandId]);

  const dis = props.readOnly || pending;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <form action={action} className="grid content-start gap-4" data-testid="template-form">
        <input type="hidden" name="brandId" value={props.brandId} />
        <fieldset disabled={dis} className="grid gap-4 sm:grid-cols-2">
          <legend className="sr-only">{t("templateTitle")}</legend>
          <Sel id="layout" label={t("layout")} value={v.layout} onChange={set("layout")} options={["card", "center", "photo"].map((k) => [k, t(`layouts.${k}`)])} />
          <Sel id="background" label={t("background")} value={v.background} onChange={set("background")} options={["ai", "plain"].map((k) => [k, t(`backgrounds.${k}`)])} />
          <Sel id="label" label={t("label")} value={v.label} onChange={set("label")} options={["category", "none"].map((k) => [k, t(`labels.${k}`)])} />
          <Sel id="accentLine" label={t("accentLine")} value={v.accentLine} onChange={set("accentLine")} options={["last", "first", "none"].map((k) => [k, t(`accentLines.${k}`)])} />
          <Sel id="typeface" label={t("typeface")} value={v.typeface} onChange={set("typeface")} options={["sans", "mono"].map((k) => [k, t(`typefaces.${k}`)])} />
          <Sel id="fontId" label={t("font")} value={v.fontId} onChange={set("fontId")} options={[["", t("fontBuiltin")], ...props.fonts.map((f) => [f.id, f.filename] as [string, string])]} />
          <Sel id="logoId" label={t("logo")} value={v.logoId} onChange={set("logoId")} options={[["", t("logoFirst")], ["none", t("logoNone")], ...props.logos.map((f) => [f.id, f.filename] as [string, string])]} />
          <div className="grid gap-1">
            <label htmlFor="footerText" className="text-sm font-medium">{t("footerText")}</label>
            <input id="footerText" name="footerText" maxLength={60} value={v.footerText} onChange={set("footerText")} placeholder="Polygon" className={inputClass} />
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <label htmlFor="overlay" className="text-sm font-medium">{t("overlay", { n: Math.round(v.overlay * 100) })}</label>
            <input id="overlay" name="overlay" type="range" min={0} max={1} step={0.05} value={v.overlay} onChange={(e) => setV((s) => ({ ...s, overlay: Number(e.target.value) }))} className="accent-[var(--color-signal)]" />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="uppercase" checked={v.uppercase} onChange={(e) => setV((s) => ({ ...s, uppercase: e.target.checked }))} /> {t("uppercase")}
          </label>
          <div className="grid grid-cols-3 gap-3 sm:col-span-2">
            {(["bg", "fg", "accent"] as const).map((k) => (
              <div key={k} className="grid gap-1">
                <label htmlFor={`c-${k}`} className="text-sm font-medium">{t(`colors.${k}`)}</label>
                <input id={`c-${k}`} name={k} type="color" value={v[k]} onChange={set(k)} className="h-10 w-full cursor-pointer rounded-lg border border-line bg-raised p-1" />
              </div>
            ))}
          </div>
        </fieldset>
        {props.readOnly ? <p className="text-sm text-muted">{tb("readOnly")}</p> : (
          <div><button type="submit" disabled={dis} className={buttonClass("primary")}>{t("saveTemplate")}</button></div>
        )}
        {state?.error ? <p role="alert" className="text-sm text-danger">{tb(`errors.${state.error}`)}</p> : null}
        {state?.ok ? <p role="status" className="text-sm">{tb("savedVersion", { v: state.ok.slice(1) })}</p> : null}
      </form>

      <section aria-labelledby="preview-h" className="grid content-start gap-3">
        <h3 id="preview-h" className="text-sm font-semibold">{t("preview")}</h3>
        {/* eslint-disable-next-line @next/next/no-img-element -- server-rendered PNG preview */}
        <img src={src} alt={t("previewAlt")} className="w-full rounded-lg ring-1 ring-line" data-testid="template-preview" />
        <div className="grid gap-1">
          <label htmlFor="previewShape" className="text-sm font-medium">{t("previewShape")}</label>
          <select id="previewShape" value={shape} onChange={(e) => setShape(e.target.value as typeof shape)} className={selectClass}>
            {(["portrait", "square", "landscape"] as const).map((k) => <option key={k} value={k}>{t(`shapes.${k}`)}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="previewText" className="text-sm font-medium">{t("previewText")}</label>
          <textarea id="previewText" rows={3} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} className={textareaClass} />
        </div>
        <p className="text-xs text-muted">{t("previewHint")}</p>
      </section>
    </div>
  );
}

function Sel({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (e: { target: { value: string } }) => void; options: [string, string][] }) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <select id={id} name={id} value={value} onChange={onChange} className={selectClass}>
        {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </div>
  );
}
