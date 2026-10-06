// Postaja UI primitives (TASK-011). Layout and density follow a calm admin-dashboard pattern; colours, type and
// voice come from docs/brand/BRAND.md. Server-safe (no hooks) so pages stay server components.
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANT: Record<Variant, string> = {
  primary: "bg-signal text-on-signal hover:brightness-110 font-semibold",
  secondary: "border border-line bg-surface text-fg hover:border-muted",
  ghost: "text-fg hover:bg-raised",
  danger: "border border-danger/60 text-danger hover:bg-danger/10",
};
export function buttonClass(variant: Variant = "secondary", size: "sm" | "md" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60",
    size === "sm" ? "h-8 px-3" : "h-9 px-4",
    VARIANT[variant],
  );
}
export function Button({ variant, size, className, ...p }: ComponentProps<"button"> & { variant?: Variant; size?: "sm" | "md" }) {
  return <button type="button" {...p} className={cx(buttonClass(variant, size), className)} />;
}
export function LinkButton({ variant, size, className, ...p }: ComponentProps<typeof Link> & { variant?: Variant; size?: "sm" | "md" }) {
  return <Link {...p} className={cx(buttonClass(variant, size), className)} />;
}

export const inputClass =
  "h-9 w-full rounded-lg border border-line bg-raised px-3 text-sm text-fg placeholder:text-muted outline-none transition focus:border-signal disabled:opacity-60";
export const textareaClass =
  "w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm text-fg placeholder:text-muted outline-none transition focus:border-signal disabled:opacity-60";
export const selectClass =
  "h-9 rounded-lg border border-line bg-raised px-3 pr-8 text-sm text-fg outline-none transition focus:border-signal";
export const labelClass = "text-sm font-medium";

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-sm text-muted">{eyebrow}</div> : null}
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ className, children, ...p }: ComponentProps<"div">) {
  return <div {...p} className={cx("rounded-xl border border-line bg-surface", className)}>{children}</div>;
}

export function Section({ title, description, actions, children, id }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={id} className="text-base font-semibold">{title}</h2>
          {description ? <p className="text-sm text-muted">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Table inside a card: uppercase muted header on a raised strip, hairline rows. */
export function DataTable({ head, children, testId, empty }: { head: ReactNode[]; children: ReactNode; testId?: string; empty?: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      {/* focusable so keyboard users can scroll wide tables on small screens */}
      <div className="overflow-x-auto" tabIndex={0}>
        <table className="w-full text-left text-sm" data-testid={testId}>
          <thead>
            <tr className="border-b border-line bg-raised/60">
              {head.map((h, i) => (
                <th key={i} scope="col" className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-0 [&>tr:hover]:bg-raised/40">{children}</tbody>
        </table>
      </div>
      {empty ? <div className="px-4 py-10 text-center text-sm text-muted">{empty}</div> : null}
    </Card>
  );
}
export const td = "px-4 py-3 align-middle";

export function EmptyState({ title, text, action, icon }: { title: ReactNode; text?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon ? <div className="text-muted">{icon}</div> : null}
      <p className="font-semibold">{title}</p>
      {text ? <p className="max-w-md text-sm text-muted">{text}</p> : null}
      {action}
    </Card>
  );
}

type Tone = "neutral" | "signal" | "ok" | "warn" | "danger";
const TONE: Record<Tone, string> = {
  neutral: "border-line text-muted",
  signal: "border-signal/50 text-accent-text",
  ok: "border-ok/40 text-ok",
  warn: "border-warn/40 text-warn",
  danger: "border-danger/40 text-danger",
};
export function Badge({ tone = "neutral", children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TONE[tone])}>
      {dot ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

/** Post status → tone (BRAND.md: ready = signal, published = green, needs review = amber, failed = red). */
export const STATUS_TONE: Record<string, Tone> = {
  generating: "neutral", ready: "signal", needs_review: "warn", approved: "ok", published: "ok", skipped: "neutral", failed: "danger", planned: "neutral",
};

export function Stat({ label, value, hint, href }: { label: ReactNode; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 text-3xl font-bold tracking-tight tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-xl border border-line bg-surface p-4 transition hover:border-muted">{body}</Link>
  ) : (
    <Card className="p-4">{body}</Card>
  );
}

export { Tabs } from "./tabs";
