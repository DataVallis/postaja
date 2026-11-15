import Image from "next/image";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { GuideBlocks } from "@/components/guide/guide-blocks";
import { termsText } from "@/server/legal/terms";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await termsText(await getLocale())).title };
}

/** The terms of use (TASK-060, ADR-095): public, in the visitor's language; the Slovenian text is binding. */
export default async function TermsPage() {
  const t = await getTranslations("Terms");
  const { title, blocks } = await termsText(await getLocale());
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <p className="mb-8">
        <Link href="/" className="inline-flex items-center gap-2 text-xl font-bold tracking-tight">
          <Image src="/mark.svg" alt="" width={24} height={24} />
          <span>postaja<span className="text-signal">.</span></span>
        </Link>
      </p>
      <h1 className="mb-6 text-3xl font-bold tracking-tight">{title}</h1>
      <article data-testid="terms"><GuideBlocks blocks={blocks} /></article>
      <p className="mt-10 text-sm text-muted"><Link href="/login" className="underline underline-offset-4">{t("back")}</Link></p>
    </main>
  );
}
