"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";

/** Sends the decision to Better Auth's consent endpoint, then follows the redirect back to Claude (with a code or access_denied). */
export function ConsentForm({ query }: { query: string }) {
  const t = useTranslations("Connect.consent");
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [failed, setFailed] = useState(false);

  async function decide(accept: boolean) {
    setBusy(accept ? "allow" : "deny");
    setFailed(false);
    try {
      const res = await fetch("/api/auth/oauth2/consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accept, oauth_query: query }) });
      const data = (await res.json().catch(() => ({}))) as { url?: string };
      if (res.ok && data.url) {
        window.location.assign(data.url);
        return;
      }
    } catch {
      /* shown below */
    }
    setFailed(true);
    setBusy(null);
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy !== null} onClick={() => void decide(true)} className="rounded-lg bg-signal px-4 py-2 font-semibold text-ink disabled:opacity-60">
          {busy === "allow" ? t("working") : t("allow")}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => void decide(false)} className="rounded-lg border border-fg/25 px-4 py-2 font-medium hover:border-fg/60 disabled:opacity-60">
          {t("deny")}
        </button>
      </div>
      {failed ? <p role="alert" className="text-sm">{t("failed")}</p> : null}
    </div>
  );
}
