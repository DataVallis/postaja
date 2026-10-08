// Post images (TASK-015, ADR-043). Bytes live in S3 under org/<org>/posts/<post>/…; these rows are the only way to
// reach them (read via forOrg). "background" is the generated picture kept for cheap re-renders; "slide" rows are
// the finished PNGs in order.
import { sql } from "drizzle-orm";
import { bigint, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { posts, type PostVisual } from "./generation";
import { organization } from "./org";

/** "video": an animated image (TASK-022/023) or a persona video (TASK-025), MP4; "keyframe": the persona video's
 *  first frame (the persona in the scene), kept with the video. */
export type MediaKind = "slide" | "background" | "video" | "keyframe";

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
    /** TASK-033: the image run (version) that made it. */
    runId: text("run_id"),
    /** TASK-033: set when a newer version replaced it on the post; kept until the member deletes that version. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("post_media_org_idx").on(t.orgId),
    // One current row per post, kind and position; earlier versions are archived next to it.
    uniqueIndex("post_media_post_kind_pos_uq").on(t.postId, t.kind, t.position).where(sql`${t.archivedAt} is null`),
    index("post_media_run_idx").on(t.postId, t.runId),
    uniqueIndex("post_media_key_uq").on(t.storageKey),
    check("post_media_kind_ck", sql`${t.kind} in ('slide','background','video','keyframe')`),
    check("post_media_size_ck", sql`${t.width} > 0 and ${t.height} > 0 and ${t.sizeBytes} > 0 and ${t.position} >= 0`),
  ],
);

/**
 * Every video made for a post (TASK-032, ADR-061; owner: "kar je enkrat kreirano naj bo vedno dostopno, razen če se
 * zbriše"): animations of an image and persona videos accumulate; nothing replaces them, a member deletes them.
 */
export type PostVideoKind = "animation" | "persona";
export const postVideos = pgTable(
  "post_videos",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    kind: text("kind").$type<PostVideoKind>().notNull(),
    /** Animation: the animated image (0-based). */
    slidePosition: integer("slide_position"),
    storageKey: text("storage_key").notNull(),
    /** Persona video: its first frame (the poster). */
    posterKey: text("poster_key"),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    model: text("model").notNull(),
    /** The motion spec (animation) or the shot (persona video) it was made from. */
    spec: jsonb("spec").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("post_videos_post_idx").on(t.orgId, t.postId, t.createdAt),
    uniqueIndex("post_videos_key_uq").on(t.storageKey),
    check("post_videos_kind_ck", sql`${t.kind} in ('animation','persona')`),
    check("post_videos_size_ck", sql`${t.width} > 0 and ${t.height} > 0 and ${t.sizeBytes} > 0`),
  ],
);

/**
 * One version of a post's images (TASK-033, ADR-062; owner: "nič ne izgine, če uporabnik sam ne izbriše"): every
 * image run (new images, a correction, words re-drawn) is a version with the words it drew; earlier versions stay
 * archived until a member restores or deletes them.
 */
export const postImageRuns = pgTable(
  "post_image_runs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    visual: jsonb("visual").$type<PostVisual>(),
    /** Illustrations this version drew on that an earlier version made (a word redraw reuses them). */
    kept: jsonb("kept").$type<string[]>().notNull().default([]),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("post_image_runs_post_idx").on(t.orgId, t.postId, t.createdAt)],
);
