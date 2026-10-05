import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { FormatPreset, RuleSet } from "@/lib/rules";
import type { Db } from "../db/client";
import { formatPresets, platformRules, type Platform } from "../db/schema";
import { REVERIFY_AFTER_DAYS, todayIso } from "./verification";

const n = (v: number | null) => (v === null ? undefined : v);

/** Platform layer of the rule engine, from the database. Throws if the platform is unknown. */
export async function getPlatformRuleSet(db: Db, platform: Platform): Promise<RuleSet> {
  const [r] = await db.select().from(platformRules).where(eq(platformRules.platform, platform));
  if (!r) throw new Error(`UNKNOWN_PLATFORM:${platform}`);
  return {
    counting: r.counting,
    captionMax: n(r.captionMax),
    visibleChars: n(r.visibleChars),
    hashtagsMax: n(r.hashtagsMax),
    mentionsMax: n(r.mentionsMax),
    threadPartMax: n(r.threadPartMax),
    threadPartsMax: n(r.threadPartsMax),
    slidesMin: n(r.slidesMin),
    slidesMax: n(r.slidesMax),
  };
}

/** Enabled preset by key; disabled or unknown presets can never be targeted. */
export async function getPreset(db: Db, key: string): Promise<FormatPreset & { platform: Platform; placement: string }> {
  const [p] = await db.select().from(formatPresets).where(and(eq(formatPresets.key, key), eq(formatPresets.enabled, true)));
  if (!p) throw new Error(`UNKNOWN_PRESET:${key}`);
  return { ...p, maxBytes: p.maxBytes, minDurationS: p.minDurationS, maxDurationS: p.maxDurationS };
}

export async function listPresets(db: Db, platform?: Platform) {
  return db
    .select()
    .from(formatPresets)
    .where(platform ? eq(formatPresets.platform, platform) : undefined)
    .orderBy(asc(formatPresets.platform), asc(formatPresets.key));
}

export async function listPlatformRules(db: Db) {
  return db.select().from(platformRules).orderBy(asc(platformRules.platform));
}

/** One platform's row for the admin editor (null if unknown). */
export async function getPlatformRuleRow(db: Db, platform: string) {
  const [r] = await db.select().from(platformRules).where(eq(platformRules.platform, platform as Platform));
  return r ?? null;
}

/** One preset for the admin editor, enabled or not (null if unknown). */
export async function getPresetRow(db: Db, key: string) {
  const [p] = await db.select().from(formatPresets).where(eq(formatPresets.key, key));
  return p ?? null;
}

/** How many rules and presets are due for quarterly re-verification (ADR-032). */
export async function countDueForReverification(db: Db, now: Date = new Date()) {
  const cutoff = new Date(Date.parse(`${todayIso(now)}T00:00:00Z`) - REVERIFY_AFTER_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [rules] = await db.select({ n: sql<number>`count(*)::int` }).from(platformRules).where(lte(platformRules.verifiedAt, cutoff));
  const [presets] = await db.select({ n: sql<number>`count(*)::int` }).from(formatPresets).where(lte(formatPresets.verifiedAt, cutoff));
  return { rules: rules.n, presets: presets.n };
}
