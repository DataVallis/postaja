// Content-plan imports (TASK-012, ADR-041): the uploaded plan, how its columns were read, and the owner's choices
// (start date, channel per platform/account). Posts created from it point back here (posts.import_id).
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organization } from "./org";

export type ImportSettings = {
  /** Day 0 for relative plans ("+12", "Dan 13"), and the first day for undated items. */
  startDate?: string | null;
  /** Undated items (e.g. a Word document) are spread from startDate every N days; null = leave unscheduled. */
  intervalDays?: number | null;
  /** "platform|account" → channel id, or "skip". */
  channelMap?: Record<string, string>;
  /** The brand the owner chose for this plan: suggestions come only from its channels. */
  brandId?: string | null;
};

export const planImports = pgTable(
  "plan_imports",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    kind: text("kind").$type<"table" | "document">().notNull(),
    status: text("status").$type<"draft" | "imported" | "discarded">().notNull().default("draft"),
    /** Parsed sheets (header + rows) for tables; null for documents. */
    tables: jsonb("tables").$type<unknown[] | null>(),
    /** One column mapping per table (see src/server/plans/mapping.ts). */
    mappings: jsonb("mappings").$type<unknown[]>().notNull().default([]),
    /** Items extracted by the AI from a document; null for tables (computed from tables + mappings). */
    items: jsonb("items").$type<unknown[] | null>(),
    settings: jsonb("settings").$type<ImportSettings>().notNull().default({}),
    /** How the structure was read: "ai" or "headers" (fallback), the model, and any provider error code. */
    reader: jsonb("reader").$type<{ by: "ai" | "headers"; model?: string; error?: string }>().notNull(),
    createdCount: integer("created_count").notNull().default(0),
    createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    importedAt: timestamp("imported_at", { withTimezone: true }),
  },
  (t) => [
    index("plan_imports_org_idx").on(t.orgId, t.createdAt),
    check("plan_imports_kind_ck", sql`${t.kind} in ('table','document')`),
    check("plan_imports_status_ck", sql`${t.status} in ('draft','imported','discarded')`),
  ],
);
