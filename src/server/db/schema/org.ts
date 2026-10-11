// Better Auth organization plugin tables (ADR-004) + Postaja's 1:1 org_settings (ADR-005).
// Organization ids are Better Auth string ids, so every tenant table uses `org_id text` (not uuid).
import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("member_org_user_uq").on(t.organizationId, t.userId),
    index("member_user_idx").on(t.userId),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invitation_email_idx").on(t.email), index("invitation_org_idx").on(t.organizationId)],
);

// starter/pro: plans before the business plan's packages (kept for existing organizations); solo/studio/agency are sold
// through Stripe (TASK-036), pilot is the 30-day agency pilot, partner is agreed by hand.
export const PLANS = ["trial", "starter", "pro", "comped", "solo", "studio", "agency", "partner", "pilot"] as const;
export type Plan = (typeof PLANS)[number];
export const ORG_STATUSES = ["active", "suspended"] as const;

export const orgSettings = pgTable(
  "org_settings",
  {
    orgId: text("org_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    plan: text("plan").$type<Plan>().notNull().default("trial"),
    status: text("status").$type<(typeof ORG_STATUSES)[number]>().notNull().default("active"),
    // Monthly provider spend cap in micro-USD (ADR-015). Default 50 USD.
    spendCapMicroUsd: bigint("spend_cap_micro_usd", { mode: "bigint" }).notNull().default(sql`50000000`),
    limits: jsonb("limits").$type<{ brands?: number; members?: number; generationsPerMonth?: number; creditsPerMonth?: number }>().notNull().default({}),
    repeatThresholds: jsonb("repeat_thresholds").$type<{ reject: number; warn: number; windowDays: number }>()
      .notNull()
      .default({ reject: 0.9, warn: 0.82, windowDays: 180 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("org_settings_plan_ck", sql`${t.plan} in ('trial','starter','pro','comped','solo','studio','agency','partner','pilot')`),
    check("org_settings_status_ck", sql`${t.status} in ('active','suspended')`),
    check("org_settings_cap_ck", sql`${t.spendCapMicroUsd} >= 0`),
  ],
);
