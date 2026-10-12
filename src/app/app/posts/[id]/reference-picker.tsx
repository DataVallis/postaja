"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AtSign, Upload } from "lucide-react";
import { buttonClass } from "@/components/ui";

type Choice = { key: string; name: string; kind: "reference" | "image" | "logo" };
const MAX = 4;
const url = (key: string) => { const [table, id] = key.split(":"); return `/api/brand-files/${table}/${id}`; };

/**
 * Reference pictures for a correction (TASK-057), inside the correction form: pick from the brand's pictures or add
 * one (stored as the brand's reference picture), and tag it in the request as @file-name. Picked ones go as `ref`.
 */
export function ReferencePicker({ brandId, choices: initial, textareaId }: { brandId: string; choices: Choice[]; textareaId: string }) {
  const t = useTranslations("Images.references");
  const [choices, setChoices] = useState(initial);
  const [picked, setPicked] = useState<string[]>([]);
  const [state, setState] = useState<"idle" | "uploading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const toggle = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : p.length >= MAX ? p : [...p, key]));
  const tag = (c: Choice) => {
    const ta = document.getElementById(textareaId) as HTMLTextAreaElement | null;
    if (!ta) return;
    const at = ta.selectionStart ?? ta.value.length;
    const ins = `${at > 0 && !/\s$/.test(ta.value.slice(0, at)) ? " " : ""}@${c.name} `;
    ta.value = ta.value.slice(0, at) + ins + ta.value.slice(ta.selectionEnd ?? at);
    ta.focus();
    ta.setSelectionRange(at + ins.length, at + ins.length);
    if (!picked.includes(c.key)) toggle(c.key);
  };

  async function upload(f: File) {
    setState("uploading");
    setError(null);
    const body = new FormData();
    body.append("file", f);
    const r = await fetch(`/api/brands/${brandId}/files?slot=reference`, { method: "POST", body }).catch(() => null);
    const j = r ? ((await r.json().catch(() => null)) as { results?: { ok: boolean; id?: string; name?: string; error?: string }[]; error?: string } | null) : null;
    const res = j?.results?.[0];
    if (!r || !res?.ok || !res.id) {
      setState("error");
      setError(res?.error ?? j?.error ?? "FAILED");
      return;
    }
    const c: Choice = { key: `asset:${res.id}`, name: res.name ?? f.name, kind: "reference" };
    setChoices((cs) => [c, ...cs]);
    setPicked((p) => (p.length >= MAX ? p : [...p, c.key]));
    setState("idle");
  }

  return (
    <fieldset className="grid gap-2" data-testid="image-references">
      <legend className="text-sm font-semibold">{t("title")}</legend>
      <p className="text-xs text-muted">{t("hint", { max: MAX })}</p>
      {choices.length ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {choices.map((c) => {
            const on = picked.includes(c.key);
            return (
              <li key={c.key} className={`grid gap-1 rounded-lg border p-1 ${on ? "border-signal" : "border-line"}`} data-testid="image-reference">
                <label className="grid cursor-pointer gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a presigned redirect, not an optimizable asset */}
                  <img src={url(c.key)} alt="" className="aspect-square w-full rounded bg-paper object-contain" loading="lazy" />
                  <span className="flex items-start gap-1 text-xs">
                    <input type="checkbox" name="ref" value={c.key} checked={on} onChange={() => toggle(c.key)} disabled={!on && picked.length >= MAX} className="mt-0.5 size-3.5 accent-signal" />
                    <span className="break-all">{c.name}</span>
                  </span>
                </label>
                <button type="button" onClick={() => tag(c)} className="flex items-center justify-center gap-1 rounded text-xs text-muted hover:text-fg" aria-label={t("tagLabel", { name: c.name })}>
                  <AtSign aria-hidden className="size-3" />{t("tag")}
                </button>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-xs text-muted">{t("none")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" id="reference-upload" data-testid="reference-upload" aria-label={t("upload")} tabIndex={-1}
          onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void upload(f); e.currentTarget.value = ""; }} />
        <button type="button" onClick={() => file.current?.click()} disabled={state === "uploading"} className={buttonClass("ghost", "sm")}>
          <Upload aria-hidden className="size-4" />{state === "uploading" ? t("uploading") : t("upload")}
        </button>
        {state === "error" ? <span role="alert" className="text-xs text-danger">{t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.FAILED")}</span> : null}
      </div>
    </fieldset>
  );
}
