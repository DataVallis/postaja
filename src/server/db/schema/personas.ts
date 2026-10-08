// Personas (TASK-024, spec §5.5, ADR-012/053): an AI influencer of a brand — DNA (a structured description) plus
// passport images (3–10 references of the same person, one primary). Every picture or video of the persona is made
// from these, so the same person appears every time. Bytes live in S3; rows are the source of truth for access.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { brands } from "./brands";
import { organization } from "./org";

/**
 * The DNA framework (owner, 2026-10-07): what every picture of the persona is generated from. Written in English
 * (image and video models read it).
 */
export const DNA_FIELDS = ["gender", "age", "ethnicity", "hairStyle", "hairColour", "clothing", "mood", "environment", "camera", "pose", "lighting", "style", "extra"] as const;
export type DnaField = (typeof DNA_FIELDS)[number];
export type PersonaDna = Record<DnaField, string>;

/** The standard passport set Postaja generates; uploads may be any of these or "other". */
export const PASSPORT_ANGLES = ["front", "three_quarter", "profile", "smile", "full_body"] as const;
export type PassportAngle = (typeof PASSPORT_ANGLES)[number] | "other";
export type PassportStatus = "none" | "queued" | "rendering" | "ready" | "failed";

export const personas = pgTable(
  "personas",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    handle: text("handle").notNull().default(""),
    dna: jsonb("dna").$type<PersonaDna>().notNull(),
    /** TASK-027: illustrations of the brand's post images show the persona (made from the passport pictures). */
    useInPosts: boolean("use_in_posts").notNull().default(true),
    /** Generation of passport images in the background. */
    passportStatus: text("passport_status").$type<PassportStatus>().notNull().default("none"),
    passportError: text("passport_error"),
    passportRequestedBy: text("passport_requested_by").references(() => user.id, { onDelete: "set null" }),
    createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("personas_org_idx").on(t.orgId),
    // One persona per brand (v1): an AI-influencer brand is the persona's channel set.
    uniqueIndex("personas_brand_uq").on(t.brandId),
    check("personas_passport_status_ck", sql`${t.passportStatus} in ('none','queued','rendering','ready','failed')`),
  ],
);

export const personaImages = pgTable(
  "persona_images",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    personaId: text("persona_id").notNull().references(() => personas.id, { onDelete: "cascade" }),
    angle: text("angle").$type<PassportAngle>().notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    source: text("source").$type<"uploaded" | "generated">().notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    filename: text("filename"),
    model: text("model"),
    prompt: text("prompt"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("persona_images_persona_idx").on(t.orgId, t.personaId),
    uniqueIndex("persona_images_key_uq").on(t.storageKey),
    uniqueIndex("persona_images_sha_uq").on(t.personaId, t.sha256),
    uniqueIndex("persona_images_primary_uq").on(t.personaId).where(sql`${t.isPrimary}`),
    check("persona_images_angle_ck", sql`${t.angle} in ('front','three_quarter','profile','smile','full_body','other')`),
    check("persona_images_source_ck", sql`${t.source} in ('uploaded','generated')`),
    check("persona_images_size_ck", sql`${t.sizeBytes} > 0`),
  ],
);
