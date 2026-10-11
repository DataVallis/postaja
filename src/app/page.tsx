import Image from "next/image";
import { getTranslations } from "next-intl/server";

export default async function Home() {
  const t = await getTranslations("Home");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <Image src="/mark.svg" alt="" width={96} height={96} priority />
      <h1 className="text-5xl font-bold tracking-tight">
        {t("title").replace(/\.$/, "")}
        <span className="text-signal">.</span>
      </h1>
      <p className="max-w-md text-lg text-muted">{t("tagline")}</p>
      <p className="text-sm text-muted">{t("status")}</p>
    </main>
  );
}
