// Post images (TASK-015, ADR-043). Bytes live in S3 under org/<org>/posts/<post>/…; these rows are the only way to
// reach them (read via forOrg). "background" is the generated picture kept for cheap re-renders; "slide" rows are
// the finished PNGs in order.
import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { posts } from "./generation";
import { organization } from "./org";

export type MediaKind = "slide" | "background";

export const postMedia = pgTable(
  "post_media",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    kind: text("kind").$type<MediaKind>().notNull(),
    position: integer("position").notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    /** Image model that made the background (null for slides). */
    model: text("model"),
    prompt: text("prompt"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("post_media_org_idx").on(t.orgId),
    uniqueIndex("post_media_post_kind_pos_uq").on(t.postId, t.kind, t.position),
    uniqueIndex("post_media_key_uq").on(t.storageKey),
    check("post_media_kind_ck", sql`${t.kind} in ('slide','background')`),
    check("post_media_size_ck", sql`${t.width} > 0 and ${t.height} > 0 and ${t.sizeBytes} > 0 and ${t.position} >= 0`),
  ],
);
