// Conversation next to the post (TASK-061, ADR-099): what the owner wrote about one post and what Postaja answered and
// changed. Every message is kept as the post's history; the text and images themselves live on the post as before.
import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { posts } from "./generation";
import { organization } from "./org";

/** What a turn changed: text rewritten, images asked for (or why not). */
export type ChatMeta = { /** The post was just written from the request. */ created?: boolean; text?: boolean; images?: boolean; error?: string };

export const postMessages = pgTable(
  "post_messages",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    body: text("body").notNull(),
    meta: jsonb("meta").$type<ChatMeta>().notNull().default({}),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("post_messages_post_idx").on(t.orgId, t.postId, t.createdAt),
    check("post_messages_role_ck", sql`${t.role} in ('user', 'assistant')`),
  ],
);
