// Ads (TASK-021, spec §5.8): an ad set is one concept for a brand, written for several ad networks (copy variants with
// each network's own fields and limits) and rendered for every chosen placement. Network field limits are data
// (`ad_networks`, sourced like platform rules, ADR-030) so they can be corrected when the networks change them.
import { sql } from "drizzle-orm";
import { check, date, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";
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
    createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ad_sets_org_brand_idx").on(t.orgId, t.brandId, t.createdAt),
    check("ad_sets_status_ck", sql`${t.status} in ('draft','ready','needs_review')`),
    check("ad_sets_objective_ck", sql`${t.objective} in ('awareness','traffic','leads','sales')`),
  ],
);
