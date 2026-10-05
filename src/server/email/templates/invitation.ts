import type { Locale } from "@/i18n/config";
import type { Mail } from "../mailer";

const copy = {
  sl: {
    subject: (org: string) => `Povabilo v Postajo: ${org}`,
    intro: (org: string, role: string) => `Povabljen si v organizacijo ${org} v Postaji (vloga: ${role}).`,
    how: "Za vstop se prijavi s tem e-poštnim naslovom na spodnji povezavi. Povabilo velja 7 dni.",
    button: "Odpri Postajo",
  },
  en: {
    subject: (org: string) => `Invitation to Postaja: ${org}`,
    intro: (org: string, role: string) => `You are invited to ${org} on Postaja (role: ${role}).`,
    how: "Sign in with this email address using the link below. The invitation is valid for 7 days.",
    button: "Open Postaja",
  },
} as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function invitationMail(to: string, orgName: string, role: string, loginUrl: string, locale: Locale = "sl"): Mail {
  const c = copy[locale];
  return {
    to,
    subject: c.subject(orgName),
    text: `${c.intro(orgName, role)}\n${c.how}\n\n${loginUrl}\n`,
    html: `<!doctype html><html lang="${locale}"><body style="font-family:Inter,Arial,sans-serif;color:#12172b;background:#f4efe6;padding:32px">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">
<p style="font-size:24px;font-weight:700;margin:0 0 16px">postaja<span style="color:#ff5a1f">.</span></p>
<p style="font-size:16px;line-height:1.5">${esc(c.intro(orgName, role))}</p>
<p style="font-size:16px;line-height:1.5">${esc(c.how)}</p>
<p style="margin:24px 0"><a href="${esc(loginUrl)}" style="background:#ff5a1f;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;display:inline-block">${esc(c.button)}</a></p>
</div></body></html>`,
  };
}
