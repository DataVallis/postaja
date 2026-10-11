// Self-serve signup (TASK-037, ADR-085): someone asks for a trial with an email and an organization name; the magic
// link proves the email; the organization is created when they confirm in /app/start. Not tenant data (no org yet).
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const signupRequests = pgTable(
  "signup_requests",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    orgName: text("org_name").notNull(),
    /** sha256 of the requester's IP with the auth secret — for rate limits only, never the IP itself. */
    ipHash: text("ip_hash").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** When the trial organization was created from it. */
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index("signup_requests_email_idx").on(t.email, t.createdAt), index("signup_requests_ip_idx").on(t.ipHash, t.createdAt)],
);
