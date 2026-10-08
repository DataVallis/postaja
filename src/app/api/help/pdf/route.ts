import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { LOCALE_COOKIE, resolveLocale } from "@/i18n/config";
import { orgContextForAction } from "@/server/auth/require";
import { guidePdf } from "@/server/guide/pdf";

export const dynamic = "force-dynamic";

/** The user guide as one PDF in the member's language (TASK-044). Signed-in members only. */
export async function GET() {
  const ctx = await orgContextForAction();
  if (!ctx) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const t = await getTranslations({ locale, namespace: "Help" });
  const today = new Date().toISOString().slice(0, 10);
  const pdf = await guidePdf(locale, { title: t("pdfTitle"), subtitle: t("pdfSubtitle", { date: today }), contents: t("pdfContents"), page: t("pdfPage") });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${locale === "en" ? "postaja-user-guide" : "postaja-navodila"}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
