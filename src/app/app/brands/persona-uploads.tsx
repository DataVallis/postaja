"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { textareaClass } from "@/components/ui";
import { CgpImport } from "./cgp-import";

/** The persona's description: typed, pasted, or the text of a document (DNA file, CGP) put in as-is. */
export function DnaText({ brandId, sources, max }: { brandId: string; sources: { id: string; filename: string }[]; max: number }) {
  const t = useTranslations("Persona");
  const [text, setText] = useState("");
  return (
    <div className="grid gap-2">
      <label htmlFor="persona-text" className="text-sm font-medium">{t("text")}</label>
      <textarea id="persona-text" name="text" rows={8} required minLength={10} maxLength={max} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={t("textPlaceholder")} aria-describedby="persona-text-hint" className={textareaClass} />
      <p id="persona-text-hint" className="text-xs text-muted">{t("textHint")}</p>
      <CgpImport brandId={brandId} sources={sources} onText={(s) => setText(s.slice(0, max))} />
    </div>
  );
}

const ANGLES = ["other", "front", "three_quarter", "profile", "smile", "full_body"] as const;

/** Owner adds pictures of the person (one request per picture; the list refreshes after each). */
export function PassportUpload({ personaId, room }: { personaId: string; room: number }) {
  const t = useTranslations("Persona");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [angle, setAngle] = useState<(typeof ANGLES)[number]>("other");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ name: string; error?: string }[]>([]);

  async function upload(files: File[]) {
    setBusy(true);
    setLog([]);
    for (const f of files.slice(0, room)) {
      const body = new FormData();
      body.append("file", f);
      body.append("angle", angle);
      let error: string | undefined;
      try {
        const res = await fetch(`/api/personas/${personaId}/images`, { method: "POST", body });
        if (!res.ok) error = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "FAILED";
      } catch {
        error = "FAILED";
      }
      setLog((l) => [...l, { name: f.name, error }]);
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <div className="grid gap-2 rounded-xl border border-dashed border-line bg-raised/40 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="passport-angle" className="text-muted">{t("angleLabel")}</label>
        <select id="passport-angle" value={angle} onChange={(e) => setAngle(e.target.value as typeof angle)} className="rounded-lg border border-muted bg-bg px-2 py-1.5">
          {ANGLES.map((a) => <option key={a} value={a}>{t(`angles.${a}`)}</option>)}
        </select>
        <button type="button" disabled={busy || room <= 0} onClick={() => input.current?.click()} className="rounded-lg border border-fg/25 px-3 py-1.5 font-medium hover:border-fg/60 disabled:opacity-60" data-testid="passport-upload">
          {busy ? t("uploading") : t("upload")}
        </button>
        <input ref={input} type="file" hidden multiple accept="image/png,image/jpeg,image/webp" aria-label={t("upload")}
          onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) void upload(files); }} />
      </div>
      <p className="text-xs text-muted">{t("uploadHint", { room })}</p>
      {log.length ? (
        <ul className="grid gap-1" aria-live="polite">
          {log.map((r, i) => (
            <li key={i} role={r.error ? "alert" : "status"} className={r.error ? "text-danger" : ""}>
              {r.name} — {r.error ? (t.has(`errors.${r.error}`) ? t(`errors.${r.error}`) : t("errors.FAILED")) : t("uploaded")}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
