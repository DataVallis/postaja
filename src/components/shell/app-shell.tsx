// The signed-in frame (TASK-011): sidebar with sections, top bar with organization, language, theme and user.
import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { resolveTheme, THEME_COOKIE } from "@/lib/theme";
import type { NavSection } from "./nav";
import { SidebarNav } from "./sidebar-nav";
import { LocaleSwitch, MobileNav, ThemeToggle, UserMenu } from "./top-controls";

export type ShellUser = { name: string; email: string; role: "user" | "superadmin" };

export async function AppShell({ user, orgName, hasOrg, children }: { user: ShellUser; orgName?: string | null; hasOrg: boolean; children: React.ReactNode }) {
  const t = await getTranslations("Shell");
  const locale = await getLocale();
  const theme = resolveTheme((await cookies()).get(THEME_COOKIE)?.value);
  const sections: NavSection[] = [
    { items: [{ href: "/app", label: t("dashboard"), icon: "dashboard", exact: true }] },
    ...(hasOrg
      ? [
          { title: t("content"), items: [{ href: "/app/plan", label: t("plan"), icon: "plan" as const }, { href: "/app/posts", label: t("posts"), icon: "posts" as const }, { href: "/app/import", label: t("import"), icon: "import" as const }, { href: "/app/brands", label: t("brands"), icon: "brands" as const }] },
          { title: t("connections"), items: [{ href: "/app/connect", label: t("claude"), icon: "claude" as const }] },
          { title: t("orgSection"), items: [{ href: "/app/team", label: t("team"), icon: "team" as const }] },
          { title: t("helpSection"), items: [{ href: "/app/help", label: t("help"), icon: "help" as const }] },
        ]
      : []),
    ...(user.role === "superadmin"
      ? [{
          title: t("admin"),
          items: [
            { href: "/admin", label: t("organizations"), icon: "orgs" as const, exact: true, also: ["/admin/orgs"] },
            { href: "/admin/platform", label: t("platform"), icon: "platform" as const },
            { href: "/admin/audit", label: t("audit"), icon: "audit" as const },
            { href: "/admin/demos", label: t("demos"), icon: "demos" as const },
            { href: "/admin/backups", label: t("backups"), icon: "backups" as const },
          ],
        }]
      : []),
  ];
  const logo = (
    <Link href="/app" className="flex items-center gap-2 px-3 text-lg font-bold tracking-tight">
      <Image src="/mark.svg" alt="" width={24} height={24} />
      <span>postaja<span className="text-signal">.</span></span>
    </Link>
  );
  return (
    <div className="min-h-screen lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col gap-6 overflow-y-auto border-r border-line bg-sidebar px-3 py-5 lg:flex">
        {logo}
        <SidebarNav sections={sections} label={t("nav")} />
      </aside>
      <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-line bg-bg/85 px-4 backdrop-blur lg:px-8">
        <MobileNav label={t("openMenu")} closeLabel={t("closeMenu")}>
          <div className="grid gap-6">{logo}<SidebarNav sections={sections} label={t("nav")} /></div>
        </MobileNav>
        <div className="lg:hidden">{logo}</div>
        {orgName ? <span className="hidden truncate text-sm text-muted sm:inline">{orgName}</span> : null}
        <div className="ml-auto flex items-center gap-1">
          <LocaleSwitch locale={locale} label={t("language")} />
          <ThemeToggle theme={theme} labels={{ toDark: t("toDark"), toLight: t("toLight") }} />
          <UserMenu name={user.name} email={user.email} labels={{ menu: t("account"), signOut: t("signOut") }} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 lg:px-8">{children}</main>
    </div>
  );
}
