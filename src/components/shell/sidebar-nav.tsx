"use client";
import { BookOpen, Users, Building2, CalendarDays, FileSpreadsheet, FileText, History, Layers, LayoutDashboard, Plug, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive, type NavIcon, type NavSection } from "./nav";

const ICONS: Record<NavIcon, typeof FileText> = {
  dashboard: LayoutDashboard, plan: CalendarDays, import: FileSpreadsheet, posts: FileText, brands: Layers, claude: Plug, help: BookOpen, team: Users, orgs: Building2, platform: SlidersHorizontal, audit: History,
};

export function SidebarNav({ sections, label, onNavigate }: { sections: NavSection[]; label: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="grid gap-6">
      {sections.map((s, i) => (
        <div key={i} className="grid gap-1">
          {s.title ? <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{s.title}</div> : null}
          {s.items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={
                  "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition " +
                  (active ? "bg-raised font-medium text-fg before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-signal" : "text-muted hover:bg-raised/60 hover:text-fg")
                }
              >
                <Icon aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
