// Brands ("projects" for the user), versioned CGP profiles and channels. All tenant tables: org_id + forOrg (ADR-005, ADR-029).
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organization } from "./org";
import { formatPresets, type Platform } from "./platform";

export type Pillar = { name: string; description: string; share: number };
export type BrandRules = {
  bannedWords: string[];
  ctaPhrases: string[];
  regexMust: string[];
  regexMustNot: string[];
  captionMax?: number;
  hashtagsMax?: number;
  emojiMax?: number;
  linksAllowed?: boolean;
  mustEndWithCta?: boolean;
};
export type BrandVisual = {
  colors: { primary?: string; secondary?: string; background?: string; text?: string; accent?: string };
  imageStyle: string;
  negativePrompt: string;
};
export const POST_TYPES = ["text", "single_image", "carousel", "animation", "video", "ad"] as const;
export type PostType = (typeof POST_TYPES)[number];

export const brands = pgTable(
  "brands",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    website: text("website"),
    languages: text("languages").array().notNull().default(sql`ARRAY['sl']::text[]`),
    currentProfileVersionId: text("current_profile_version_id"),
    /** The brand design (TASK-017) used for new images; a ready version of brand_designs. */
    currentDesignId: text("current_design_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("brands_org_slug_uq").on(t.orgId, t.slug), index("brands_org_idx").on(t.orgId)],
);

export const brandProfileVersions = pgTable(
  "brand_profile_versions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    cgp: text("cgp").notNull().default(""),
    rules: jsonb("rules").$type<BrandRules>().notNull(),
    pillars: jsonb("pillars").$type<Pillar[]>().notNull().default([]),
    visual: jsonb("visual").$type<BrandVisual>().notNull(),
    note: text("note"),
    createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bpv_brand_version_uq").on(t.brandId, t.version),
    index("bpv_org_idx").on(t.orgId),
    check("bpv_version_ck", sql`${t.version} >= 1`),
  ],
);

export const channels = pgTable(
  "channels",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    platform: text("platform").$type<Platform>().notNull(),
    handle: text("handle").notNull(),
    language: text("language").notNull().default("sl"),
    goal: jsonb("goal").$type<{ postsPerDay: number; weekdays: number[] }>().notNull(),
    rules: jsonb("rules").$type<{ captionMax?: number; hashtagsMax?: number; linksAllowed?: boolean }>().notNull().default({}),
    allowedTypes: text("allowed_types").array().$type<PostType[]>().notNull(),
    defaultPresetKey: text("default_preset_key").references(() => formatPresets.key, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("channels_org_idx").on(t.orgId),
    index("channels_brand_idx").on(t.brandId),
    uniqueIndex("channels_brand_platform_handle_uq").on(t.brandId, t.platform, t.handle),
  ],
);
