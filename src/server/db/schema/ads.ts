// Ads (TASK-021, spec §5.8): an ad set is one concept for a brand, written for several ad networks (copy variants with
// each network's own fields and limits) and rendered for every chosen placement. Network field limits are data
// (`ad_networks`, sourced like platform rules, ADR-030) so they can be corrected when the networks change them.
import { sql } from "drizzle-orm";
import { bigint, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { brandAssets } from "./brand-files";
import { brands } from "./brands";
import { organization } from "./org";

export const AD_NETWORKS = ["meta", "linkedin", "google_display"] as const;
export type AdNetwork = (typeof AD_NETWORKS)[number];
export const AD_OBJECTIVES = ["awareness", "traffic", "leads", "sales"] as const;
export type AdObjective = (typeof AD_OBJECTIVES)[number];

/** One text field of an ad on a network: how many (1 = a single text) and how long (hard limit, visible length). */
export type AdField = { key: string; label: string; min: number; max: number; maxChars: number; recommended: number | null };

export const adNetworks = pgTable("ad_networks", {
  key: text("key").$type<AdNetwork>().primaryKey(),
  label: text("label").notNull(),
  fields: jsonb("fields").$type<AdField[]>().notNull(),
  /** The network's call-to-action buttons (empty: the network picks it). */
  ctas: jsonb("ctas").$type<string[]>().notNull().default([]),
  /** Format presets offered as placements, ticked by default. */
  placements: text("placements").array().notNull(),
  source: text("source").notNull(),
  confidence: text("confidence").$type<"high" | "medium" | "low">().notNull(),
  verifiedAt: date("verified_at").notNull(),
});

/** One copy variant: per network, per field a text (count 1) or a list of texts. Plus the CTA button per network. */
export type AdCopyVariant = Partial<Record<AdNetwork, Record<string, string | string[]>>>;
export type AdCopyIssue = { variant: number; network: AdNetwork; field: string; index?: number; code: "too_long" | "too_few" | "too_many" | "banned_word" | "bad_cta" | "long_visible"; actual: number | string; limit: number | string };

/** Per copy variant: the brand template, the words on the image and what its illustration shows (TASK-021b). */
export type AdVisual = { designId: string; variants: { templateId: string; slots: Record<string, string>; illustration: string | null }[] };
export type AdMediaStatus = "none" | "queued" | "rendering" | "ready" | "failed";

export const adSets = pgTable(
  "ad_sets",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    objective: text("objective").$type<AdObjective>().notNull(),
    networks: text("networks").array().$type<AdNetwork[]>().notNull(),
    placements: text("placements").array().notNull(),
    offer: text("offer").notNull().default(""),
    landingUrl: text("landing_url"),
    brief: text("brief").notNull().default(""),
    language: text("language").notNull(),
    /** draft (copy being written or failed), ready (no hard issue), needs_review (a limit or rule is broken). */
    status: text("status").$type<"draft" | "ready" | "needs_review">().notNull().default("draft"),
    copy: jsonb("copy").$type<AdCopyVariant[]>().notNull().default([]),
    issues: jsonb("issues").$type<AdCopyIssue[]>().notNull().default([]),
    model: text("model"),
    error: text("error"),
    /** TASK-035: a partner's logo drawn next to the brand logo on the creatives (null = none). */
    partnerLogoId: text("partner_logo_id").references(() => brandAssets.id, { onDelete: "set null" }),
    visual: jsonb("visual").$type<AdVisual>(),
    mediaStatus: text("media_status").$type<AdMediaStatus>().notNull().default("none"),
    mediaError: text("media_error"),
    mediaRequestedBy: text("media_requested_by").references(() => user.id, { onDelete: "set null" }),
    createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ad_sets_org_brand_idx").on(t.orgId, t.brandId, t.createdAt),
    check("ad_sets_status_ck", sql`${t.status} in ('draft','ready','needs_review')`),
    check("ad_sets_objective_ck", sql`${t.objective} in ('awareness','traffic','leads','sales')`),
    check("ad_sets_media_status_ck", sql`${t.mediaStatus} in ('none','queued','rendering','ready','failed')`),
  ],
);

/** An ad set's images: one illustration per variant, and one creative per placement × variant. Access only via the row. */
export const adMedia = pgTable(
  "ad_media",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    adSetId: text("ad_set_id").notNull().references(() => adSets.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"illustration" | "creative">().notNull(),
    variant: integer("variant").notNull(),
    /** Format preset key for creatives; "" for illustrations. */
    placement: text("placement").notNull().default(""),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    model: text("model"),
    prompt: text("prompt"),
    /** TASK-034: the creatives run (version) that made it; archived when a newer run replaced it. */
    runId: text("run_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ad_media_org_idx").on(t.orgId),
    uniqueIndex("ad_media_set_kind_variant_placement_uq").on(t.adSetId, t.kind, t.variant, t.placement).where(sql`${t.archivedAt} is null`),
    index("ad_media_run_idx").on(t.adSetId, t.runId),
    uniqueIndex("ad_media_key_uq").on(t.storageKey),
    check("ad_media_kind_ck", sql`${t.kind} in ('illustration','creative')`),
  ],
);

/** A version of an ad set's creatives (TASK-034, ADR-062): the words and illustrations it drew. */
export const adCreativeRuns = pgTable(
  "ad_creative_runs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    adSetId: text("ad_set_id").notNull().references(() => adSets.id, { onDelete: "cascade" }),
    visual: jsonb("visual").$type<AdVisual>(),
    /** Illustrations this version drew on that an earlier version made (a word redraw reuses them). */
    kept: jsonb("kept").$type<string[]>().notNull().default([]),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ad_creative_runs_set_idx").on(t.orgId, t.adSetId, t.createdAt)],
);

/** An earlier version of an ad set's copy (TASK-034, ADR-062): kept whenever new copy replaces it (AI or a save). */
export const adCopyVersions = pgTable(
  "ad_copy_versions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    adSetId: text("ad_set_id").notNull().references(() => adSets.id, { onDelete: "cascade" }),
    copy: jsonb("copy").$type<AdCopyVariant[]>().notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    /** When this copy was replaced (it was current until then). */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ad_copy_versions_set_idx").on(t.orgId, t.adSetId, t.createdAt)],
);
