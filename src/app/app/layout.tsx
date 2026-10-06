import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getRequestContext } from "@/server/auth/session";
import { SignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/login");
  const t = await getTranslations("App");
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-6">
      <header className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-muted/30 pb-4">
        <Link href="/app" className="text-xl font-bold tracking-tight">
          postaja<span className="text-signal">.</span>
        </Link>
        <nav aria-label={t("nav")} className="flex gap-4 text-sm">
          <Link href="/app" className="underline-offset-4 hover:underline">{t("home")}</Link>
          {ctx.org ? <Link href="/app/brands" className="underline-offset-4 hover:underline">{t("brands")}</Link> : null}
          {ctx.org ? <Link href="/app/connect" className="underline-offset-4 hover:underline">{t("claude")}</Link> : null}
          {ctx.user.role === "superadmin" ? <Link href="/admin" className="underline-offset-4 hover:underline">{t("adminLink")}</Link> : null}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {ctx.org ? <span className="text-muted">{ctx.org.orgName}</span> : null}
          <SignOutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
