// Quarterly re-verification of platform data (TASK-004b, ADR-032). Pure functions, no DB.

/** A rule or preset is due for re-verification once its verified date is this many days old (or older). */
export const REVERIFY_AFTER_DAYS = 90;

const DAY_MS = 86_400_000;

/** Today as YYYY-MM-DD in UTC (the column is a plain `date`). */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Whole days between two YYYY-MM-DD dates (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** Due when verified ≥ 90 days ago: 89 days → fine, 90 → due. */
export function isDueForReverification(verifiedAt: string, now: Date = new Date()): boolean {
  return daysBetween(verifiedAt, todayIso(now)) >= REVERIFY_AFTER_DAYS;
}
