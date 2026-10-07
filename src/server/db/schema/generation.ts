// Post generation (TASK-007, ADR-036): global model registry with prices, posts, and a usage ledger that also holds
// spend reservations (so parallel generations cannot jointly exceed the org's monthly cap).
import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { brandProfileVersions, brands, channels } from "./brands";
import { organization } from "./org";
import { planImports } from "./plans";

/**
 * Prices are micro-USD per million tokens (e.g. $2 / MTok = 2_000_000) for text models, and micro-USD per megapixel
 * (rounded up per image) for image models (TASK-015). Super admin keeps them current.
 */
export const modelRegistry = pgTable(
  "model_registry",
  {
    id: text("id").primaryKey(),
    provider: text("provider").$type<"anthropic" | "fal">().notNull(),
    modelKey: text("model_key").notNull(),
    /** "image_style": an image model that takes the brand's example images as style reference (TASK-017). */
    kind: text("kind").$type<"text" | "image" | "image_style">().notNull(),
    label: text("label").notNull(),
    inputPerMtok: bigint("input_per_mtok", { mode: "bigint" }).notNull(),
    outputPerMtok: bigint("output_per_mtok", { mode: "bigint" }).notNull(),
    cacheWritePerMtok: bigint("cache_write_per_mtok", { mode: "bigint" }).notNull(),
    cacheReadPerMtok: bigint("cache_read_per_mtok", { mode: "bigint" }).notNull(),
    perMegapixel: bigint("per_megapixel", { mode: "bigint" }).notNull().default(sql`0`),
    /** Image models priced per picture (micro-USD), added to the per-megapixel price. */
    perImage: bigint("per_image", { mode: "bigint" }).notNull().default(sql`0`),
    isDefault: boolean("is_default").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    source: text("source").notNull(),
    verifiedAt: date("verified_at").notNull(),
  },
  (t) => [
    uniqueIndex("model_registry_provider_key_uq").on(t.provider, t.modelKey),
    // At most one default per kind.
    uniqueIndex("model_registry_default_uq").on(t.kind).where(sql`${t.isDefault}`),
    check("model_registry_prices_ck", sql`${t.inputPerMtok} >= 0 and ${t.outputPerMtok} >= 0 and ${t.cacheWritePerMtok} >= 0 and ${t.cacheReadPerMtok} >= 0 and ${t.perMegapixel} >= 0 and ${t.perImage} >= 0`),
  ],
);

export const POST_STATUSES = ["planned", "generating", "ready", "needs_review", "failed", "approved", "published", "skipped"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
export type PostContent = { caption: string; hashtags: string[]; parts?: string[] };
/** Images of a post (TASK-015): none yet → queued → rendering → ready | failed. */
export const MEDIA_STATUSES = ["none", "queued", "rendering", "ready", "failed"] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];
/** What Claude chose for a post's images (TASK-017): a template of the brand design per slide, the words on it, and
 *  what the illustration should show (null when the template has none). The owner can edit the words. */
export type PostVisual = {
  designId: string;
  slides: { templateId: string; slots: Record<string, string>; illustration: string | null }[];
  /** The owner's last correction in words (TASK-017 follow-up), shown on the post page. */
  revision?: string;
};
export const POST_FORMATS = ["text", "image", "carousel", "thread", "video"] as const;
export type PostFormat = (typeof POST_FORMATS)[number];
/** What a content plan says about a post beyond its text (TASK-012). Everything optional; shown on the post page. */
export type PostPlan = {
  topic?: string; category?: string; audience?: string; account?: string; cta?: string; link?: string; firstComment?: string;
  imagePrompt?: string; overlayText?: string; slides?: string[]; slideCount?: number; notes?: string; sourceRef?: string;
};

export const posts = pgTable(
  "posts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    channelId: text("channel_id").references(() => channels.id, { onDelete: "set null" }),
    profileVersionId: text("profile_version_id").notNull().references(() => brandProfileVersions.id, { onDelete: "restrict" }),
    type: text("type").$type<"text">().notNull().default("text"),
    brief: text("brief").notNull(),
    status: text("status").$type<PostStatus>().notNull().default("generating"),
    format: text("format").$type<PostFormat>().notNull().default("text"),
    /** Planned day (and optional "HH:MM" time, the brand's local time) from a plan or set by hand. */
    scheduledOn: date("scheduled_on"),
    scheduledTime: text("scheduled_time"),
    plan: jsonb("plan").$type<PostPlan>().notNull().default({}),
    importId: text("import_id").references(() => planImports.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    content: jsonb("content").$type<PostContent>(),
    topicSummary: text("topic_summary"),
    ruleFailures: jsonb("rule_failures").$type<{ code: string; actual: number | string; limit: number | string; part?: number }[]>().notNull().default([]),
    fixAttempts: integer("fix_attempts").notNull().default(0),
    model: text("model"),
    error: text("error"),
    visual: jsonb("visual").$type<PostVisual>(),
    mediaStatus: text("media_status").$type<MediaStatus>().notNull().default("none"),
    mediaError: text("media_error"),
    /** Who asked for the images last; the worker acts as this member (ADR-043). */
    mediaRequestedBy: text("media_requested_by").references(() => user.id, { onDelete: "set null" }),
    createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("posts_org_idx").on(t.orgId),
    index("posts_brand_created_idx").on(t.brandId, t.createdAt),
    check("posts_status_ck", sql`${t.status} in ('planned','generating','ready','needs_review','failed','approved','published','skipped')`),
    check("posts_format_ck", sql`${t.format} in ('text','image','carousel','thread','video')`),
    check("posts_time_ck", sql`${t.scheduledTime} is null or ${t.scheduledTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    index("posts_org_scheduled_idx").on(t.orgId, t.scheduledOn),
    check("posts_type_ck", sql`${t.type} in ('text')`),
    check("posts_media_status_ck", sql`${t.mediaStatus} in ('none','queued','rendering','ready','failed')`),
  ],
);

/** One row per provider call. `reserved` rows hold the worst-case estimate until the call settles (ADR-036). */
export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    brandId: text("brand_id").references(() => brands.id, { onDelete: "set null" }),
    postId: text("post_id").references(() => posts.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    state: text("state").$type<"reserved" | "settled">().notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    /** Image calls: billed megapixels (rounded up per image). */
    megapixels: integer("megapixels").notNull().default(0),
    costMicroUsd: bigint("cost_micro_usd", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("usage_ledger_org_created_idx").on(t.orgId, t.createdAt),
    check("usage_ledger_state_ck", sql`${t.state} in ('reserved','settled')`),
    check("usage_ledger_cost_ck", sql`${t.costMicroUsd} >= 0`),
  ],
);
