"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

const button = "rounded-lg bg-signal px-4 py-2 font-semibold text-ink disabled:opacity-60";
const ACCEPT = {
  logo: "image/png,image/jpeg,image/webp",
  font: ".ttf,.otf,font/ttf,font/otf",
  source: ".pdf,.docx,.xlsx,.pptx,.csv,.txt,.md,image/png,image/jpeg,image/webp",
} as const;

/** Uploads one or more files to /api/brands/<id>/files one after another and reports each result. */
export function UploadForm({ brandId, slot, maxMb }: { brandId: string; slot: "logo" | "font" | "source"; maxMb: number }) {
  const t = useTranslations("Brands.files");
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<{ name: string; ok: boolean; text: string }[]>([]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const files = [...(ref.current?.files ?? [])];
    if (!files.length) return;
    setBusy(true);
    const out: typeof messages = [];
    for (const file of files) {
      if (file.size > maxMb * 1024 * 1024) {
        out.push({ name: file.name, ok: false, text: t("errors.TOO_LARGE", { mb: maxMb }) });
        continue;
      }
      const body = new FormData();
      body.append("file", file);
      try {
        const res = await fetch(`/api/brands/${brandId}/files?slot=${slot}`, { method: "POST", body });
        const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        out.push(
          res.ok
            ? { name: file.name, ok: true, text: t("uploaded") }
            : { name: file.name, ok: false, text: t.has(`errors.${data.error}`) ? t(`errors.${data.error}`, { mb: maxMb, detail: data.detail ?? "" }) : t("errors.failed") },
        );
      } catch {
        out.push({ name: file.name, ok: false, text: t("errors.failed") });
      }
    }
    setMessages(out);
    setBusy(false);
    if (ref.current) ref.current.value = "";
    router.refresh();
  }

  const id = `upload-${slot}`;
  return (
    <form onSubmit={submit} className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium">{t(`choose.${slot}`)}</label>
      <div className="flex flex-wrap items-center gap-3">
        <input id={id} ref={ref} type="file" name="file" accept={ACCEPT[slot]} multiple={slot !== "logo"} required aria-describedby={`${id}-hint`} className="text-sm" />
        <button type="submit" disabled={busy} className={button}>{busy ? t("uploading") : t("upload")}</button>
      </div>
      <span id={`${id}-hint`} className="text-xs text-muted">{t(`hint.${slot}`, { mb: maxMb })}</span>
      {messages.length ? (
        <ul className="grid gap-1 text-sm" aria-live="polite">
          {messages.map((m, i) => (
            <li key={i}><span role={m.ok ? "status" : "alert"}>{m.name}: {m.text}</span></li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
