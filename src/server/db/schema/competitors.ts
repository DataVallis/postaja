// Competitor research (spec §4.3, ADR-023/066). TASK-049: per brand, competitors Claude finds with web search (from the
// CGP) or the owner adds; suggestions are kept or removed on purpose. Collection and analysis follow (TASK-050).
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { brands } from "./brands";
import { organization } from "./org";

export const COMPETITOR_PLATFORMS = ["instagram", "facebook", "linkedin", "x", "tiktok", "youtube"] as const;
export type CompetitorPlatform = (typeof COMPETITOR_PLATFORMS)[number];
/** A public social profile of a competitor (only public pages are ever read). */
export type CompetitorHandle = { platform: CompetitorPlatform; url: string };

export const competitors = pgTable(
  "competitors",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    website: text("website"),
    handles: jsonb("handles").$type<CompetitorHandle[]>().notNull().default([]),
    /** "ai" = found by Claude, "manual" = added by a member. */
    source: text("source").$type<"ai" | "manual">().notNull(),
    /** A suggestion until a member keeps it; manual ones are kept from the start. */
    status: text("status").$type<"suggested" | "kept">().notNull(),
    /** Why it is a competitor (Claude's reason, or the member's note). */
    reason: text("reason").notNull().default(""),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("competitors_brand_idx").on(t.orgId, t.brandId),
    check("competitors_source_ck", sql`${t.source} in ('ai','manual')`),
    check("competitors_status_ck", sql`${t.status} in ('suggested','kept')`),
  ],
);

/** One background run for a brand: "find" (TASK-049); "analyze" comes with TASK-050. */
export const competitorRuns = pgTable(
  "competitor_runs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"find">().notNull(),
    status: text("status").$type<"queued" | "running" | "done" | "failed">().notNull().default("queued"),
    /** The member's wish for this run ("only Slovenian", "also agencies"…). */
    hint: text("hint").notNull().default(""),
    error: text("error"),
    /** How many new suggestions the run added (duplicates of known competitors are skipped). */
    added: integer("added").notNull().default(0),
    model: text("model"),
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("competitor_runs_brand_idx").on(t.orgId, t.brandId, t.createdAt),
    check("competitor_runs_kind_ck", sql`${t.kind} in ('find')`),
    check("competitor_runs_status_ck", sql`${t.status} in ('queued','running','done','failed')`),
  ],
);
