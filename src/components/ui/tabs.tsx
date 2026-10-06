"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

/** Link tabs driven by a query parameter (shareable URLs, server-rendered panels). The active tab is read on the client
 * so the underline follows the URL immediately on soft navigation. */
export function Tabs({ tabs, param = "tab", defaultKey, label }: { tabs: { key: string; label: ReactNode; href: string; count?: number }[]; param?: string; defaultKey: string; label: string }) {
  const active = useSearchParams().get(param) ?? defaultKey;
  return (
    <nav aria-label={label} className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const on = t.key === active || (!tabs.some((x) => x.key === active) && t.key === defaultKey);
        return (
          <Link
            key={t.key}
            href={t.href}
            scroll={false}
            aria-current={on ? "page" : undefined}
            className={
              "-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition " +
              (on ? "border-signal text-fg" : "border-transparent text-muted hover:text-fg")
            }
          >
            {t.label}
            {t.count !== undefined ? <span className="rounded-full bg-raised px-1.5 text-xs text-muted">{t.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
