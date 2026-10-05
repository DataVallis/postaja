import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSuperadmin } from "@/server/admin/guard";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await requireSuperadmin();
  const t = await getTranslations("Admin");
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-8">
      <header className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-muted/30 pb-4">
        <Link href="/admin" className="text-xl font-bold tracking-tight">
          postaja<span className="text-signal">.</span> <span className="text-sm font-medium text-muted">admin</span>
        </Link>
        <nav aria-label={t("nav")} className="flex gap-4 text-sm">
          <Link href="/admin" className="underline-offset-4 hover:underline">{t("organizations")}</Link>
          <Link href="/admin/platform" className="underline-offset-4 hover:underline">{t("platform")}</Link>
          <Link href="/admin/audit" className="underline-offset-4 hover:underline">{t("audit")}</Link>
          <Link href="/app" className="underline-offset-4 hover:underline">{t("backToApp")}</Link>
        </nav>
        <span className="ml-auto text-sm text-muted">{me.email}</span>
      </header>
      {children}
    </div>
  );
}
