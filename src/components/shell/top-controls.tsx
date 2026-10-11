"use client";
import { Languages, LogOut, Menu, Moon, Sun, UserCircle2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

const YEAR = 60 * 60 * 24 * 365;
const setCookie = (name: string, value: string) => { document.cookie = `${name}=${value}; path=/; max-age=${YEAR}; samesite=lax`; };
const iconBtn = "inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted transition hover:bg-raised hover:text-fg";

export function ThemeToggle({ theme, labels }: { theme: Theme; labels: { toDark: string; toLight: string } }) {
  const [t, setT] = useState(theme);
  const next: Theme = t === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className={iconBtn}
      aria-label={t === "dark" ? labels.toLight : labels.toDark}
      title={t === "dark" ? labels.toLight : labels.toDark}
      onClick={() => { setCookie(THEME_COOKIE, next); document.documentElement.dataset.theme = next; setT(next); }}
    >
      {t === "dark" ? <Sun aria-hidden className="size-4" /> : <Moon aria-hidden className="size-4" />}
    </button>
  );
}

export function LocaleSwitch({ locale, label }: { locale: string; label: string }) {
  const router = useRouter();
  const next = locale === "sl" ? "en" : "sl";
  return (
    <button type="button" className={iconBtn} aria-label={label} title={label} onClick={() => { setCookie("NEXT_LOCALE", next); router.refresh(); }}>
      <Languages aria-hidden className="size-4" />
      <span className="font-semibold uppercase">{locale}</span>
    </button>
  );
}

export function UserMenu({ name, email, labels }: { name: string; email: string; labels: { menu: string; signOut: string } }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" className={iconBtn} aria-haspopup="menu" aria-expanded={open} aria-label={labels.menu} onClick={() => setOpen((o) => !o)}>
        <UserCircle2 aria-hidden className="size-5" />
        <span className="hidden max-w-40 truncate font-medium text-fg sm:inline">{name || email}</span>
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-line bg-surface p-1 shadow-xl shadow-black/20">
          <div className="px-3 py-2 text-sm">
            <div className="truncate font-medium">{name || email}</div>
            <div className="truncate text-muted">{email}</div>
          </div>
          <div className="my-1 border-t border-line" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-raised"
            onClick={async () => { await authClient.signOut(); router.push("/login"); router.refresh(); }}
          >
            <LogOut aria-hidden className="size-4" /> {labels.signOut}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Below lg the sidebar is a drawer; this button opens it (the drawer content is rendered by the server shell). */
export function MobileNav({ label, closeLabel, children }: { label: string; closeLabel: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${iconBtn} lg:hidden`} aria-label={label} aria-expanded={open} onClick={() => setOpen(true)}>
        <Menu aria-hidden className="size-5" />
      </button>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label={closeLabel} className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-line bg-sidebar p-4" onClickCapture={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }}>
            <div className="mb-4 flex justify-end">
              <button type="button" className={iconBtn} aria-label={closeLabel} onClick={() => setOpen(false)}><X aria-hidden className="size-5" /></button>
            </div>
            {children}
          </div>
        </div>
      ) : null}
    </>
  );
}
