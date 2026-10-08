import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { buttonClass, PageHeader } from "@/components/ui";
import { GuideBlocks } from "@/components/guide/guide-blocks";
import { requireOrgPage } from "@/server/auth/require";
import { guideChapters } from "@/server/guide/guide";
import { plain } from "@/server/guide/markdown";

export const dynamic = "force-dynamic";

/** One chapter of the user guide (TASK-026), with its sections and the previous/next chapter. */
export default async function HelpChapterPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireOrgPage();
  const { slug } = await params;
  const t = await getTranslations("Help");
  const chapters = await guideChapters(await getLocale());
  const i = chapters.findIndex((c) => c.slug === slug);
  if (i < 0) notFound();
  const c = chapters[i];
  const [prev, next] = [chapters[i - 1], chapters[i + 1]];
  const sections = c.blocks.filter((b) => b.t === "h" && b.level === 2);
  return (
    <>
      <PageHeader eyebrow={<Link href="/app/help" className="hover:text-fg hover:underline">{t("title")}</Link>} title={`${i + 1}. ${c.title}`} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <article data-testid="help-chapter"><GuideBlocks blocks={c.blocks} /></article>
        {sections.length > 1 ? (
          <nav aria-label={t("onThisPage")} className="order-first lg:order-none">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("onThisPage")}</p>
            <ul className="grid gap-1.5 text-sm">
              {sections.map((b) => b.t === "h" ? <li key={b.id}><a href={`#${b.id}`} className="text-muted hover:text-fg hover:underline">{plain(b.v)}</a></li> : null)}
            </ul>
          </nav>
        ) : null}
      </div>
      <nav aria-label={t("chapters")} className="mt-10 flex flex-wrap justify-between gap-3 border-t border-line pt-6">
        {prev ? <Link href={`/app/help/${prev.slug}`} className={buttonClass("secondary", "sm")}>← {t("prev")}: {prev.title}</Link> : <Link href="/app/help" className={buttonClass("ghost", "sm")}>{t("back")}</Link>}
        {next ? <Link href={`/app/help/${next.slug}`} className={buttonClass("secondary", "sm")}>{t("next")}: {next.title} →</Link> : <Link href="/app/help" className={buttonClass("ghost", "sm")}>{t("back")}</Link>}
      </nav>
    </>
  );
}
