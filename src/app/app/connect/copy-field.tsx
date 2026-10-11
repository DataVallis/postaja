"use client";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";

export function CopyField({ label, value }: { label: string; value: string }) {
  const t = useTranslations("Connect");
  const id = useId();
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid max-w-2xl gap-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div className="flex gap-2">
        <input id={id} readOnly value={value} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded-lg border border-muted bg-bg px-3 py-2 font-mono text-sm text-fg" />
        <button
          type="button"
          onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
          className="rounded-lg border border-fg/25 px-3 py-2 text-sm font-medium hover:border-fg/60"
        >
          {copied ? t("copied") : t("copy")}
        </button>
      </div>
    </div>
  );
}
