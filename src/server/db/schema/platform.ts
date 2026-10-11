// Global platform data (not tenant-scoped). Values are data, not code (ADR-020, ADR-022, ADR-030):
// every row carries its source, verification date and confidence; super admins keep them current.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const PLATFORMS = ["instagram", "facebook", "linkedin", "x", "tiktok", "youtube", "google_display"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const platformRules = pgTable(
  "platform_rules",
  {
    platform: text("platform").$type<Platform>().primaryKey(),
    counting: text("counting").$type<"graphemes" | "x_weighted">().notNull().default("graphemes"),
    captionMax: integer("caption_max"),
    visibleChars: integer("visible_chars"),
    hashtagsMax: integer("hashtags_max"),
    mentionsMax: integer("mentions_max"),
    linksClickable: boolean("links_clickable").notNull().default(true),
    threadPartMax: integer("thread_part_max"),
    threadPartsMax: integer("thread_parts_max"),
    slidesMin: integer("slides_min"),
    slidesMax: integer("slides_max"),
    source: text("source").notNull(),
    confidence: text("confidence").$type<"high" | "medium" | "low">().notNull(),
    notes: text("notes"),
    verifiedAt: date("verified_at").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("platform_rules_counting_ck", sql`${t.counting} in ('graphemes','x_weighted')`),
    check("platform_rules_confidence_ck", sql`${t.confidence} in ('high','medium','low')`),
  ],
);

export const formatPresets = pgTable(
  "format_presets",
  {
    key: text("key").primaryKey(),
    platform: text("platform").$type<Platform>().notNull(),
    placement: text("placement").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    media: text("media").$type<"image" | "video" | "pdf">().notNull(),
    maxBytes: bigint("max_bytes", { mode: "number" }),
    minDurationS: integer("min_duration_s"),
    maxDurationS: integer("max_duration_s"),
    safeZone: jsonb("safe_zone").$type<{ top: number; right: number; bottom: number; left: number }>()
      .notNull()
      .default({ top: 0, right: 0, bottom: 0, left: 0 }),
    enabled: boolean("enabled").notNull().default(true),
    source: text("source").notNull(),
    confidence: text("confidence").$type<"high" | "medium" | "low">().notNull(),
    notes: text("notes"),
    verifiedAt: date("verified_at").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("format_presets_media_ck", sql`${t.media} in ('image','video','pdf')`),
    check("format_presets_size_ck", sql`${t.width} > 0 and ${t.height} > 0`),
    check("format_presets_confidence_ck", sql`${t.confidence} in ('high','medium','low')`),
  ],
);
