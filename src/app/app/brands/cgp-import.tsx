"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * "Uvozi CGP iz dokumenta": a document from the computer or one of the brand's uploaded sources → its text is put into
 * the CGP field as-is (no AI). Nothing is saved until the owner clicks "Shrani novo verzijo" (ADR-037).
 */
export function CgpImport({ brandId, sources, onText }: { brandId: string; sources: { id: string; filename: string }[]; onText: (text: string) => void }) {
  const t = useTranslations("Brands.cgpImport");
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");

  async function run(body: FormData) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/brands/${brandId}/cgp-import`, { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as { text?: string; filename?: string; error?: string; detail?: string };
      if (res.ok && data.text) {
        onText(data.text);
        setMsg({ ok: true, text: t("inserted", { name: data.filename ?? "", chars: data.text.length }) });
      } else {
        setMsg({ ok: false, text: t.has(`errors.${data.error}`) ? t(`errors.${data.error}`, { detail: data.detail ?? "" }) : t("errors.failed") });
      }
    } catch {
      setMsg({ ok: false, text: t("errors.failed") });
    }
    setBusy(false);
  }

  return (
    <div className="grid gap-2 rounded-xl border border-dashed border-line bg-raised/40 p-3 text-sm ">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="rounded-lg border border-fg/25 px-3 py-1.5 font-medium hover:border-fg/60 disabled:opacity-60">
          {busy ? t("reading") : t("fromComputer")}
        </button>
        <input
          ref={input}
          type="file"
          hidden
          accept=".pdf,.docx,.md,.txt,application/pdf"
          aria-label={t("fromComputer")}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const body = new FormData();
            body.append("file", f);
            void run(body);
          }}
        />
        {sources.length ? (
          <>
            <span className="text-muted">{t("or")}</span>
            <label htmlFor="cgp-source" className="sr-only">{t("fromSource")}</label>
            <select id="cgp-source" value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="max-w-56 rounded-lg border border-muted bg-bg px-2 py-1.5">
              {sources.map((s) => <option key={s.id} value={s.id}>{s.filename}</option>)}
            </select>
            <button type="button" disabled={busy || !sourceId} onClick={() => { const body = new FormData(); body.append("sourceId", sourceId); void run(body); }} className="rounded-lg border border-fg/25 px-3 py-1.5 font-medium hover:border-fg/60 disabled:opacity-60">
              {t("useSource")}
            </button>
          </>
        ) : null}
      </div>
      <p className="text-xs text-muted">{t("hint")}</p>
      {msg ? <p role={msg.ok ? "status" : "alert"}>{msg.text}</p> : null}
    </div>
  );
}
