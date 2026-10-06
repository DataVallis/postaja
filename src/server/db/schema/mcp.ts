// Claude ↔ Postaja via MCP (TASK-010, ADR-038): CGP drafts sent by Claude for the owner to review, and a log of
// every tool call (who, which org, which client, which tool, outcome) — never the arguments themselves.
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { brands } from "./brands";
import { organization } from "./org";

/** A CGP proposed from outside the editor (Claude). Never active until the owner saves it as a profile version. */
export const cgpDrafts = pgTable(
  "cgp_drafts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    note: text("note"),
    source: text("source").$type<"claude">().notNull(),
    status: text("status").$type<"pending" | "used" | "discarded">().notNull().default("pending"),
    createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("cgp_drafts_brand_idx").on(t.brandId, t.createdAt),
    index("cgp_drafts_org_idx").on(t.orgId),
    check("cgp_drafts_status_ck", sql`${t.status} in ('pending','used','discarded')`),
    check("cgp_drafts_source_ck", sql`${t.source} in ('claude')`),
  ],
);

export const mcpToolCalls = pgTable(
  "mcp_tool_calls",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    tool: text("tool").notNull(),
    ok: text("ok").$type<"ok" | "error">().notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mcp_tool_calls_org_created_idx").on(t.orgId, t.createdAt), check("mcp_tool_calls_ok_ck", sql`${t.ok} in ('ok','error')`)],
);
