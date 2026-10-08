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

/** One background run for a brand: "find" (TASK-049) or "analyze" (TASK-050). */
export const competitorRuns = pgTable(
  "competitor_runs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"find" | "analyze">().notNull(),
    status: text("status").$type<"queued" | "running" | "done" | "failed">().notNull().default("queued"),
    /** The member's wish for this run ("only Slovenian", "also agencies"…). */
    hint: text("hint").notNull().default(""),
    error: text("error"),
    /** How many new suggestions the run added (duplicates of known competitors are skipped). */
    added: integer("added").notNull().default(0),
    model: text("model"),
    /** The report an "analyze" run produced (TASK-050). */
    reportId: text("report_id"),
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("competitor_runs_brand_idx").on(t.orgId, t.brandId, t.createdAt),
    check("competitor_runs_kind_ck", sql`${t.kind} in ('find','analyze')`),
    check("competitor_runs_status_ck", sql`${t.status} in ('queued','running','done','failed')`),
  ],
);

/**
 * What Postaja collected about a competitor (TASK-050): its public website's text (fetched again on each analysis) and
 * screenshots members upload (their posts, ads, carousels) — kept until a member deletes them.
 */
export const competitorItems = pgTable(
  "competitor_items",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    competitorId: text("competitor_id").notNull().references(() => competitors.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"web_page" | "upload">().notNull(),
    url: text("url"),
    title: text("title"),
    /** Readable text of a web page (≤ 20,000 characters). */
    text: text("text"),
    /** Why a page could not be read (BLOCKED, HTTP, TIMEOUT, NOT_HTML, NO_TEXT, …). */
    error: text("error"),
    storageKey: text("storage_key"),
    filename: text("filename"),
    width: integer("width"),
    height: integer("height"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("competitor_items_competitor_idx").on(t.orgId, t.competitorId),
    check("competitor_items_kind_ck", sql`${t.kind} in ('web_page','upload')`),
  ],
);

export type CompetitorProfile = {
  name: string;
  positioning: string;
  pillars: string[];
  formats: string[];
  hooks: string[];
  ctas: string[];
  visual: string;
  tone: string;
  offers: string[];
};
export type Evidence = { competitor: string; source: string };
/** One learning; `decision` is the member's tick (null until decided). */
export type Learning = { id: string; kind: "adopt" | "reject"; title: string; why: string; evidence: Evidence[]; decision: "yes" | "no" | null };
export type Gap = { topic: string; why: string; competitors: string[] };

/** One analysis of the brand's kept competitors (TASK-050); every report stays until deleted. */
export const competitorReports = pgTable(
  "competitor_reports",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    profiles: jsonb("profiles").$type<CompetitorProfile[]>().notNull(),
    learnings: jsonb("learnings").$type<Learning[]>().notNull(),
    gaps: jsonb("gaps").$type<Gap[]>().notNull(),
    /** The CGP draft made from the accepted learnings, when sent. */
    draftId: text("draft_id"),
    model: text("model"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("competitor_reports_brand_idx").on(t.orgId, t.brandId, t.createdAt)],
);
