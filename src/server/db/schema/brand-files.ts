// Uploaded brand files (TASK-005b, ADR-033). Bytes live in S3; these rows are the source of truth for access:
// a file is reachable only through its row, read via forOrg. Keys are generated server-side and never reused.
import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { brands } from "./brands";
import { organization } from "./org";

export const SOURCE_KINDS = ["pdf", "docx", "xlsx", "csv", "pptx", "text", "image"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const ASSET_KINDS = ["logo", "font"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

const common = {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  storageKey: text("storage_key").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};

/** Raw material for the AI-built CGP (TASK-006 extracts it). `status` starts at `uploaded`. */
export const brandSources = pgTable(
  "brand_sources",
  {
    ...common,
    kind: text("kind").$type<SourceKind>().notNull(),
    status: text("status").$type<"uploaded" | "extracting" | "extracted" | "failed">().notNull().default("uploaded"),
    extract: jsonb("extract").$type<Record<string, unknown>>(),
    error: text("error"),
  },
  (t) => [
    index("brand_sources_org_idx").on(t.orgId),
    index("brand_sources_brand_idx").on(t.brandId),
    uniqueIndex("brand_sources_key_uq").on(t.storageKey),
    uniqueIndex("brand_sources_brand_sha_uq").on(t.brandId, t.sha256),
    check("brand_sources_kind_ck", sql`${t.kind} in ('pdf','docx','xlsx','csv','pptx','text','image')`),
    check("brand_sources_status_ck", sql`${t.status} in ('uploaded','extracting','extracted','failed')`),
    check("brand_sources_size_ck", sql`${t.sizeBytes} > 0`),
  ],
);

export type AssetMeta = { width?: number; height?: number; family?: string | null; missingGlyphs?: string[] };

/** Files used when rendering: logos and fonts. */
export const brandAssets = pgTable(
  "brand_assets",
  {
    ...common,
    kind: text("kind").$type<AssetKind>().notNull(),
    meta: jsonb("meta").$type<AssetMeta>().notNull().default({}),
  },
  (t) => [
    index("brand_assets_org_idx").on(t.orgId),
    index("brand_assets_brand_idx").on(t.brandId),
    uniqueIndex("brand_assets_key_uq").on(t.storageKey),
    uniqueIndex("brand_assets_brand_sha_uq").on(t.brandId, t.sha256),
    check("brand_assets_kind_ck", sql`${t.kind} in ('logo','font')`),
    check("brand_assets_size_ck", sql`${t.sizeBytes} > 0`),
  ],
);
