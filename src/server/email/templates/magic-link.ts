import type { Locale } from "@/i18n/config";
import type { Mail } from "../mailer";

const copy = {
  sl: {
    subject: "Prijava v Postajo",
    intro: "Klikni spodnjo povezavo za prijavo v Postajo. Povezava velja 10 minut in jo lahko uporabiš enkrat.",
    button: "Prijava",
    ignore: "Če se nisi poskušal prijaviti, to sporočilo ignoriraj.",
  },
  en: {
    subject: "Sign in to Postaja",
    intro: "Click the link below to sign in to Postaja. The link is valid for 10 minutes and works once.",
    button: "Sign in",
    ignore: "If you did not try to sign in, ignore this email.",
  },
} as const;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function magicLinkMail(to: string, url: string, locale: Locale = "sl"): Mail {
  const c = copy[locale];
  const safeUrl = escapeHtml(url);
  return {
    to,
    subject: c.subject,
    text: `${c.intro}\n\n${url}\n\n${c.ignore}\n`,
    html: `<!doctype html><html lang="${locale}"><body style="font-family:Inter,Arial,sans-serif;color:#12172b;background:#f4efe6;padding:32px">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">
<p style="font-size:24px;font-weight:700;margin:0 0 16px">postaja<span style="color:#ff5a1f">.</span></p>
<p style="font-size:16px;line-height:1.5">${escapeHtml(c.intro)}</p>
<p style="margin:24px 0"><a href="${safeUrl}" style="background:#ff5a1f;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;display:inline-block">${escapeHtml(c.button)}</a></p>
<p style="font-size:13px;color:#4a5068;word-break:break-all">${safeUrl}</p>
<p style="font-size:13px;color:#4a5068">${escapeHtml(c.ignore)}</p>
</div></body></html>`,
  };
}
