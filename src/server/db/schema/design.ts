// Brand designs (TASK-017, ADR-044): the visual system Claude makes for one brand, versioned. A version starts
// "generating" (the worker asks Claude), then holds the validated spec ("ready") or the reason it failed.
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { DesignSpec } from "../../design/spec";
import { user } from "./auth";
import { brands } from "./brands";
import { organization } from "./org";

export type DesignStatus = "generating" | "ready" | "failed";

export const brandDesigns = pgTable(
  "brand_designs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status").$type<DesignStatus>().notNull().default("generating"),
    spec: jsonb("spec").$type<DesignSpec>(),
    /** The owner's words: how the graphics should look. */
    brief: text("brief").notNull().default(""),
    /** A revision request ("naslov večji …"); null for a design made from scratch. */
    instruction: text("instruction"),
    basedOn: text("based_on"),
    error: text("error"),
    model: text("model"),
    createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("brand_designs_org_idx").on(t.orgId),
    uniqueIndex("brand_designs_brand_version_uq").on(t.brandId, t.version),
    check("brand_designs_status_ck", sql`${t.status} in ('generating','ready','failed')`),
  ],
);
