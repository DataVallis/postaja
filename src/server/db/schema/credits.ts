// Credits (TASK-038, ADR-071): every paid AI action costs credits from a price table the super admin edits; an
// organization spends its plan's monthly allowance first, then bought or granted packs (valid 12 months). The € spend
// cap (ADR-015) stays as the hard safety limit underneath.
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organization } from "./org";

export const CREDIT_ACTIONS = ["text", "illustration", "animation", "persona_image", "persona_video_5s", "persona_video_10s", "research", "assist"] as const;
export type CreditAction = (typeof CREDIT_ACTIONS)[number];

export const creditPrices = pgTable(
  "credit_prices",
  {
    action: text("action").$type<CreditAction>().primaryKey(),
    credits: integer("credits").notNull(),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("credit_prices_credits_ck", sql`${t.credits} >= 0 and ${t.credits} <= 10000`)],
);

/** Packs offered for sale (credits and price); the checkout comes with billing (TASK-036). */
export const CREDIT_PACKS = { small: { credits: 500, priceEur: 25 }, large: { credits: 2000, priceEur: 80 } } as const;
export type CreditPackKey = keyof typeof CREDIT_PACKS;

export const creditPacks = pgTable(
  "credit_packs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    credits: integer("credits").notNull(),
    remaining: integer("remaining").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** grant = given by a super admin; purchase = paid (from a request now, from checkout with TASK-036). */
    source: text("source").$type<"grant" | "purchase">().notNull(),
    note: text("note").notNull().default(""),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("credit_packs_org_idx").on(t.orgId, t.expiresAt),
    check("credit_packs_amount_ck", sql`${t.credits} > 0 and ${t.remaining} >= 0 and ${t.remaining} <= ${t.credits}`),
    check("credit_packs_source_ck", sql`${t.source} in ('grant','purchase')`),
  ],
);

/** An owner's "Kupi kredite" until billing exists: the super admin confirms payment and grants the pack. */
export const creditRequests = pgTable(
  "credit_requests",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    pack: text("pack").$type<CreditPackKey>().notNull(),
    status: text("status").$type<"pending" | "granted" | "declined">().notNull().default("pending"),
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    resolvedBy: text("resolved_by").references(() => user.id, { onDelete: "set null" }),
    packId: text("pack_id").references(() => creditPacks.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("credit_requests_org_idx").on(t.orgId, t.createdAt),
    check("credit_requests_pack_ck", sql`${t.pack} in ('small','large')`),
    check("credit_requests_status_ck", sql`${t.status} in ('pending','granted','declined')`),
  ],
);
