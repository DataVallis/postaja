import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Download } from "lucide-react";
import { buttonClass, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireOrgPage } from "@/server/auth/require";
import { guideChapters } from "@/server/guide/guide";
import { plain } from "@/server/guide/markdown";

export const dynamic = "force-dynamic";

/** The user guide's table of contents (TASK-026): every chapter with its sections. */
export default async function HelpPage() {
  await requireOrgPage();
  const t = await getTranslations("Help");
  const locale = await getLocale();
  const chapters = await guideChapters(locale);
  return (
    <>
      <PageHeader title={t("title")} description={<>{t("description")}{t("slOnly") ? <> {t("slOnly")}</> : null}</>}
        actions={<a href="/api/help/pdf" className={buttonClass("secondary")} data-testid="help-pdf"><Download aria-hidden className="size-4" />{t("pdf")}</a>} />
      {chapters.length === 0 ? <EmptyState title={t("empty")} /> : (
        <nav aria-label={t("chapters")}>
          <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="help-chapters">
            {chapters.map((c, i) => (
              <li key={c.slug}>
                <Card className="grid h-full content-start gap-2 p-5">
                  <h2 className="font-semibold"><Link href={`/app/help/${c.slug}`} className="hover:text-signal hover:underline">{i + 1}. {c.title}</Link></h2>
                  <ul className="grid gap-1 text-sm text-muted">
                    {c.blocks.filter((b) => b.t === "h" && b.level === 2).map((b) => b.t === "h" ? (
                      <li key={b.id}><Link href={`/app/help/${c.slug}#${b.id}`} className="hover:text-fg hover:underline">{plain(b.v)}</Link></li>
                    ) : null)}
                  </ul>
                </Card>
              </li>
            ))}
          </ol>
        </nav>
      )}
    </>
  );
}
