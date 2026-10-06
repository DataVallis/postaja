// Calendar dates for plans (TASK-013). Plans are kept as local calendar days ("YYYY-MM-DD") and "HH:MM" in the
// brands' time zone; Postaja is Slovenian first, so one zone for now. Pure functions, no Date-in-local-zone surprises.
export const APP_TZ = "Europe/Ljubljana";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string | undefined | null): s is string {
  if (!s || !ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Today in the app's time zone (not the server's). */
export function todayIn(tz = APP_TZ, now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/** 1 = Monday … 7 = Sunday. */
export const isoWeekday = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
export const startOfWeek = (d: string) => addDays(d, 1 - isoWeekday(d));
export const startOfMonth = (d: string) => `${d.slice(0, 7)}-01`;
export function addMonths(d: string, n: number): string {
  const [y, m] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 10);
}

/** The visible range of a calendar view: a month grid is whole weeks (Mon–Sun) covering the month. */
export function viewRange(view: "month" | "week" | "day", anchor: string): { from: string; to: string; days: string[] } {
  let from: string, to: string;
  if (view === "day") from = to = anchor;
  else if (view === "week") { from = startOfWeek(anchor); to = addDays(from, 6); }
  else {
    from = startOfWeek(startOfMonth(anchor));
    const last = addDays(addMonths(startOfMonth(anchor), 1), -1);
    to = addDays(startOfWeek(last), 6);
  }
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return { from, to, days };
}

/** Previous / next anchor for the navigation arrows. */
export function stepAnchor(view: "month" | "week" | "day", anchor: string, dir: -1 | 1): string {
  if (view === "month") return addMonths(startOfMonth(anchor), dir);
  return addDays(anchor, dir * (view === "week" ? 7 : 1));
}
