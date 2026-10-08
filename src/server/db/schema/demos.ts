// Demo from a website (TASK-040, ADR-070): a super admin enters a prospect's website; Postaja builds a demo brand in the
// sales organization ("Data Vallis – prodaja", its own spend cap) with 3 posts and 1 ad set, shown through a public
// read-only link that expires after 14 days. Only a hash of the link's token is stored.
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { adSets } from "./ads";
import { user } from "./auth";
import { brands } from "./brands";
import { organization } from "./org";

export const DEMO_STATUSES = ["queued", "running", "ready", "failed"] as const;
export type DemoStatus = (typeof DEMO_STATUSES)[number];
/** Where a running demo is (shown in /admin/demos while it is being built). */
export const DEMO_STEPS = ["site", "brand", "design", "posts", "images", "ad", "done"] as const;
export type DemoStep = (typeof DEMO_STEPS)[number];

export const demos = pgTable(
  "demos",
  {
    id: text("id").primaryKey(),
    /** The sales organization the demo brand lives in. */
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    brandId: text("brand_id").references(() => brands.id, { onDelete: "set null" }),
    url: text("url").notNull(),
    /** Optional: the brand name and text from the site pasted by hand (when the site cannot be read). */
    nameHint: text("name_hint").notNull().default(""),
    pastedText: text("pasted_text").notNull().default(""),
    status: text("status").$type<DemoStatus>().notNull().default("queued"),
    step: text("step").$type<DemoStep>().notNull().default("site"),
    error: text("error"),
    /** What could not be made, while the rest was (e.g. "IMAGES:SPEND_CAP"); the demo is still shown. */
    warnings: text("warnings").array().notNull().default(sql`ARRAY[]::text[]`),
    postIds: text("post_ids").array().notNull().default(sql`ARRAY[]::text[]`),
    adSetId: text("ad_set_id").references(() => adSets.id, { onDelete: "set null" }),
    /** sha256 of the share link's token (base64url); null until a link is made. A new link replaces the old one. */
    tokenHash: text("token_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("demos_token_uq").on(t.tokenHash),
    index("demos_org_idx").on(t.orgId, t.createdAt),
    check("demos_status_ck", sql`${t.status} in ('queued','running','ready','failed')`),
  ],
);
