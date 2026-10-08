// Sidebar structure (TASK-011). Only real pages are listed; future sections (plan, calendar, import) join here.
export type NavIcon = "dashboard" | "plan" | "import" | "posts" | "brands" | "claude" | "help" | "orgs" | "platform" | "audit";
export type NavItem = { href: string; label: string; icon: NavIcon; exact?: boolean; also?: string[] };
export type NavSection = { title?: string; items: NavItem[] };

export function isActive(pathname: string, item: NavItem): boolean {
  const hit = (base: string, exact?: boolean) => (exact ? pathname === base : pathname === base || pathname.startsWith(`${base}/`));
  return hit(item.href, item.exact) || (item.also ?? []).some((a) => hit(a));
}
