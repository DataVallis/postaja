// AI post ideas (TASK-019, spec §6.2–6.3): Claude proposes ideas for a brand's channel and free slots, each checked
// against the brand's recent posts (no-repeat, ADR-048); the owner ticks the ones to keep, they become planned posts.
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { brands, channels } from "./brands";
import { organization } from "./org";

export type Idea = {
  title: string;
  angle: string;
  pillar: string | null;
  format: "text" | "image" | "carousel" | "thread";
  /** The free slot it is proposed for (YYYY-MM-DD), or null when the range had no free day. */
  date: string | null;
  /** The closest earlier post when it is similar enough to mention (score ≥ REPEAT_WARN). */
  similar: { postId: string; label: string; date: string | null; score: number } | null;
};

export const ideaRuns = pgTable(
  "idea_runs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    status: text("status").$type<"draft" | "accepted" | "discarded">().notNull().default("draft"),
    ideas: jsonb("ideas").$type<Idea[]>().notNull(),
    /** Ideas Claude proposed that repeated a recent post and were replaced. */
    replaced: integer("replaced").notNull().default(0),
    hint: text("hint").notNull().default(""),
    createdCount: integer("created_count").notNull().default(0),
    createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idea_runs_org_idx").on(t.orgId, t.createdAt),
    check("idea_runs_status_ck", sql`${t.status} in ('draft','accepted','discarded')`),
  ],
);
