// Client approval links (TASK-041, ADR-069): an agency member shares a secret link for one brand and a date range; the
// agency's client sees the planned posts without an account and approves them or asks for changes, with a comment.
// Only a hash of the link's token is stored; a link expires and can be revoked.
import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { brands } from "./brands";
import { posts } from "./generation";
import { organization } from "./org";

export const approvalLinks = pgTable(
  "approval_links",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    /** sha256 of the token in the URL (base64url); the token itself is shown once, at creation. */
    tokenHash: text("token_hash").notNull(),
    /** Who the link is for ("Polygon – Ana"), shown to the agency only. */
    label: text("label").notNull(),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("approval_links_token_uq").on(t.tokenHash),
    index("approval_links_brand_idx").on(t.orgId, t.brandId),
    check("approval_links_range_ck", sql`${t.toDate} >= ${t.fromDate}`),
  ],
);

/** What the client said about a post through a link; every review is kept (the post's history). */
export const postReviews = pgTable(
  "post_reviews",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    linkId: text("link_id").references(() => approvalLinks.id, { onDelete: "set null" }),
    decision: text("decision").$type<"approved" | "changes">().notNull(),
    comment: text("comment").notNull().default(""),
    /** The name the client typed (optional). */
    reviewer: text("reviewer").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("post_reviews_post_idx").on(t.orgId, t.postId, t.createdAt),
    check("post_reviews_decision_ck", sql`${t.decision} in ('approved','changes')`),
  ],
);
