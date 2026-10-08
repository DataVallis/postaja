"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

/** Screenshots of a competitor's posts or ads (TASK-050): several at once, one request each; the list refreshes. */
export function ScreenshotUpload({ competitorId, name }: { competitorId: string; name: string }) {
  const t = useTranslations("Competitors");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ file: string; error: string }[]>([]);

  async function upload(files: File[]) {
    setBusy(true);
    setErrors([]);
    for (const f of files) {
      const body = new FormData();
      body.append("file", f);
      let error: string | undefined;
      try {
        const res = await fetch(`/api/competitors/${competitorId}/screenshots`, { method: "POST", body });
        if (!res.ok) error = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "FAILED";
      } catch {
        error = "FAILED";
      }
      if (error) setErrors((e) => [...e, { file: f.name, error }]);
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <div className="grid gap-1">
      <button type="button" onClick={() => input.current?.click()} disabled={busy} className="justify-self-start rounded-lg border border-fg/25 px-3 py-1.5 text-sm font-medium hover:border-fg/60 disabled:opacity-60">
        {busy ? t("uploading") : t("addScreenshots")}
      </button>
      <input ref={input} type="file" multiple hidden accept="image/png,image/jpeg,image/webp" aria-label={t("addScreenshotsFor", { name })}
        onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; void upload(f); }} />
      {errors.map((e) => <p key={e.file} role="alert" className="text-xs text-danger">{e.file}: {t.has(`errors.${e.error}`) ? t(`errors.${e.error}`) : t("errors.FAILED")}</p>)}
    </div>
  );
}
