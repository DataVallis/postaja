// TASK-037: the trial ends soon — one email to the owners, with the way to a plan. Nothing made is lost.
import type { Locale } from "@/i18n/config";
import type { Mail } from "../mailer";

const copy = {
  sl: {
    subject: "Preizkus Postaje se izteka",
    intro: (org: string, date: string) => `Preizkus Postaje za ${org} se konča ${date}. Potem ustvarjanje novih objav, slik in videov ustavimo; vse, kar ste naredili, ostane na voljo za ogled in prenos.`,
    next: "Paket izberete v Postaji pod Ekipa in paket. Solo 39 €, Studio 149 €, Agencija 499 € na mesec (brez DDV).",
    button: "Izberi paket",
  },
  en: {
    subject: "Your Postaja trial is ending",
    intro: (org: string, date: string) => `The Postaja trial for ${org} ends on ${date}. After that, creating new posts, images and videos stops; everything you made stays viewable and downloadable.`,
    next: "Choose a plan in Postaja under Team and plan. Solo €39, Studio €149, Agency €499 a month (excl. VAT).",
    button: "Choose a plan",
  },
} as const;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function trialEndingMail(to: string, org: string, date: string, url: string, locale: Locale = "sl"): Mail {
  const c = copy[locale];
  const intro = c.intro(org, date);
  const safeUrl = escapeHtml(url);
  return {
    to,
    subject: c.subject,
    text: `${intro}\n\n${c.next}\n\n${url}\n`,
    html: `<!doctype html><html lang="${locale}"><body style="font-family:Inter,Arial,sans-serif;color:#12172b;background:#f4efe6;padding:32px">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">
<p style="font-size:24px;font-weight:700;margin:0 0 16px">postaja<span style="color:#ff5a1f">.</span></p>
<p style="font-size:16px;line-height:1.5">${escapeHtml(intro)}</p>
<p style="font-size:16px;line-height:1.5">${escapeHtml(c.next)}</p>
<p style="margin:24px 0"><a href="${safeUrl}" style="background:#ff5a1f;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;display:inline-block">${escapeHtml(c.button)}</a></p>
</div></body></html>`,
  };
}
