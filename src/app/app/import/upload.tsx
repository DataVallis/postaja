"use client";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { buttonClass } from "@/components/ui";

/** Drop or pick one plan file; the server reads it (AI names the columns) and we open the review screen. */
export function PlanUpload() {
  const t = useTranslations("Import.upload");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  async function send(file: File) {
    setBusy(file.name);
    setError(null);
    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch("/api/imports", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string; detail?: string };
      if (res.ok && data.id) {
        router.push(`/app/import/${data.id}`);
        return;
      }
      setError(t.has(`errors.${data.error}`) ? t(`errors.${data.error}`, { detail: data.detail ?? "" }) : t("errors.failed"));
    } catch {
      setError(t("errors.failed"));
    }
    setBusy(null);
  }

  return (
    <div
      data-testid="plan-dropzone"
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f && !busy) void send(f); }}
      className={`grid justify-items-start gap-4 rounded-xl border-2 border-dashed p-6 transition ${over ? "border-signal bg-signal/10" : "border-line bg-surface"}`}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-raised"><FileSpreadsheet aria-hidden className="size-5" /></span>
        <div>
          <p className="font-semibold">{t("title")}</p>
          <p className="text-sm text-muted">{t("hint")}</p>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        hidden
        aria-label={t("pick")}
        accept=".xlsx,.csv,.tsv,.docx,.pdf,.md,.txt"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void send(f); }}
      />
      <button type="button" disabled={!!busy} onClick={() => input.current?.click()} className={buttonClass("primary")}>
        {busy ? <><Loader2 aria-hidden className="size-4 animate-spin" />{t("reading")}</> : t("pick")}
      </button>
      {busy ? <p role="status" className="text-sm text-muted">{t("readingHint", { name: busy })}</p> : null}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
