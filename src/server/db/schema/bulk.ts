// Bulk creation (TASK-014, ADR-042): one run = a set of posts and the step to do for each ("text" now, "image" with
// TASK-015). Items carry the per-post outcome so progress is a count and a failed post does not stop the others.
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { brands } from "./brands";
import { posts } from "./generation";
import { organization } from "./org";

export type BulkScope =
  | { kind: "day"; date: string; brandId?: string | null }
  | { kind: "brand"; brandId: string; from: string; to: string | null };
export type BulkStep = "text" | "image";
export type BulkRunStatus = "queued" | "running" | "done" | "cancelled";
export type BulkItemStatus = "queued" | "running" | "done" | "skipped" | "failed";

export const bulkRuns = pgTable(
  "bulk_runs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    brandId: text("brand_id").references(() => brands.id, { onDelete: "set null" }),
    scope: jsonb("scope").$type<BulkScope>().notNull(),
    steps: jsonb("steps").$type<BulkStep[]>().notNull(),
    status: text("status").$type<BulkRunStatus>().notNull().default("queued"),
    total: integer("total").notNull(),
    createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("bulk_runs_org_idx").on(t.orgId, t.createdAt),
    check("bulk_runs_status_ck", sql`${t.status} in ('queued','running','done','cancelled')`),
  ],
);

export const bulkItems = pgTable(
  "bulk_items",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => bulkRuns.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    step: text("step").$type<BulkStep>().notNull(),
    status: text("status").$type<BulkItemStatus>().notNull().default("queued"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("bulk_items_run_idx").on(t.runId, t.status),
    index("bulk_items_org_idx").on(t.orgId),
    uniqueIndex("bulk_items_run_post_step_uq").on(t.runId, t.postId, t.step),
    check("bulk_items_status_ck", sql`${t.status} in ('queued','running','done','skipped','failed')`),
    check("bulk_items_step_ck", sql`${t.step} in ('text','image')`),
  ],
);
