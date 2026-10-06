// What Claude can do in Postaja through MCP (TASK-010, ADR-038). Every function takes a verified OrgContext, reads
// and writes only through forOrg and the existing services, and applies the same owner/editor rules as the app.
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { CGP_MAX_CHARS, listBrandFiles, uploadBrandFile } from "../brands/files";
import { getBrandDetail, listBrands } from "../brands/service";
import type { Db } from "../db/client";
import { brands, cgpDrafts, mcpToolCalls } from "../db/schema";
import type { Storage } from "../files/storage";
import { firstMembershipOrgId } from "../orgs/invitations";
import { resolveOrgContext, TenancyError, type OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";

export class McpError extends Error {
  constructor(public readonly code: "NO_ORGANIZATION" | "NOT_FOUND" | "FORBIDDEN" | "ARCHIVED" | "INVALID" | "TOO_LONG", message: string) {
    super(message);
  }
}

/** The organization a token's user works in: the first membership, re-verified like every app request. */
export async function mcpContext(db: Db, userId: string): Promise<OrgContext> {
  const orgId = await firstMembershipOrgId(db, userId);
  if (!orgId) throw new McpError("NO_ORGANIZATION", "Your Postaja account is not a member of any organization.");
  try {
    return await resolveOrgContext(db, { userId, activeOrganizationId: orgId });
  } catch (e) {
    if (e instanceof TenancyError) throw new McpError("NO_ORGANIZATION", "Your organization is not available (suspended or removed).");
    throw e;
  }
}

/** A brand by id or slug (as Claude will usually say "inzenirji"), in this org only. */
export async function findBrand(db: Db, ctx: OrgContext, ref: string) {
  const s = forOrg(db, ctx);
  const [b] = ((await s.select(brands, eq(brands.id, ref))) as (typeof brands.$inferSelect)[]).concat(
    (await s.select(brands, eq(brands.slug, ref.trim().toLowerCase()))) as (typeof brands.$inferSelect)[],
  );
  if (!b) throw new McpError("NOT_FOUND", `No brand "${ref}" in ${ctx.orgName}. Use list_brands to see the brands.`);
  return b;
}

const requireOwner = (ctx: OrgContext, what: string) => {
  if (ctx.role !== "owner") throw new McpError("FORBIDDEN", `Only the organization owner can ${what}.`);
};

export async function mcpListBrands(db: Db, ctx: OrgContext) {
  const list = await listBrands(db, ctx);
  return Promise.all(
    list.map(async (b) => {
      const d = await getBrandDetail(db, ctx, b.id);
      return {
        id: b.id, slug: b.slug, name: b.name, languages: b.languages, website: b.website ?? null,
        channels: d.channels.map((c) => ({ id: c.id, platform: c.platform, handle: c.handle, language: c.language })),
      };
    }),
  );
}

export async function mcpGetBrand(db: Db, ctx: OrgContext, ref: string) {
  const b = await findBrand(db, ctx, ref);
  const d = await getBrandDetail(db, ctx, b.id);
  const files = await listBrandFiles(db, ctx, b.id);
  return {
    id: b.id, slug: b.slug, name: b.name, languages: b.languages, archived: !!b.archivedAt,
    cgp: d.profile?.cgp ?? "", profileVersion: d.profile?.version ?? 0,
    rules: d.profile?.rules ?? null, pillars: d.profile?.pillars ?? [],
    channels: d.channels.map((c) => ({ id: c.id, platform: c.platform, handle: c.handle, language: c.language })),
    materials: files.sources.map((s) => ({ filename: s.filename, kind: s.kind })),
    logos: files.logos.length, fonts: files.fonts.map((f) => f.meta.family ?? f.filename),
  };
}

export const proposeCgpInput = z.object({ brand: z.string().min(1), cgp: z.string().trim().min(1), note: z.string().trim().max(500).optional() });

/**
 * Owner only. Stores the text as a pending draft (earlier pending drafts of the brand are discarded). It never changes
 * the active CGP: the owner opens the brand, inserts the draft into the editor and saves a version (ADR-035, ADR-038).
 */
export async function proposeCgp(db: Db, ctx: OrgContext, input: z.input<typeof proposeCgpInput>, appUrl: string) {
  requireOwner(ctx, "propose a CGP");
  const data = proposeCgpInput.parse(input);
  if (data.cgp.length > CGP_MAX_CHARS) throw new McpError("TOO_LONG", `The CGP has ${data.cgp.length} characters; the maximum is ${CGP_MAX_CHARS}.`);
  const b = await findBrand(db, ctx, data.brand);
  if (b.archivedAt) throw new McpError("ARCHIVED", "The brand is archived.");
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    const t = forOrg(tx as unknown as Db, ctx);
    await t.update(cgpDrafts, { status: "discarded", resolvedAt: new Date() }, and(eq(cgpDrafts.brandId, b.id), eq(cgpDrafts.status, "pending")));
    await t.insert(cgpDrafts, { id, brandId: b.id, text: data.cgp, note: data.note ?? null, source: "claude", createdBy: ctx.userId });
  });
  return { draftId: id, brand: b.name, reviewUrl: `${appUrl}/app/brands/${b.id}#profile-h`, chars: data.cgp.length };
}

export async function pendingDraft(db: Db, ctx: OrgContext, brandId: string) {
  const [d] = (await forOrg(db, ctx).select(cgpDrafts, and(eq(cgpDrafts.brandId, brandId), eq(cgpDrafts.status, "pending")))) as (typeof cgpDrafts.$inferSelect)[];
  return d ?? null;
}

export async function discardDraft(db: Db, ctx: OrgContext, draftId: string) {
  requireOwner(ctx, "discard a CGP draft");
  const rows = await forOrg(db, ctx).update(cgpDrafts, { status: "discarded", resolvedAt: new Date() }, and(eq(cgpDrafts.id, draftId), eq(cgpDrafts.status, "pending")));
  if (!rows.length) throw new McpError("NOT_FOUND", "No such pending draft.");
}

export const addMaterialInput = z.object({
  brand: z.string().min(1),
  filename: z.string().trim().min(1).max(200),
  text: z.string().min(1).max(2_000_000),
});

/** Owner only. Text from the conversation becomes a brand material (Markdown unless the name says .txt/.csv). */
export async function addTextMaterial(db: Db, storage: Storage, ctx: OrgContext, input: z.input<typeof addMaterialInput>) {
  requireOwner(ctx, "add materials");
  const data = addMaterialInput.parse(input);
  const b = await findBrand(db, ctx, data.brand);
  const filename = /\.(md|txt|csv)$/i.test(data.filename) ? data.filename : `${data.filename}.md`;
  const r = await uploadBrandFile(db, storage, ctx, b.id, "source", { filename, bytes: new TextEncoder().encode(data.text) });
  return { id: r.id, brand: b.name, filename, kind: r.kind };
}

/** One row per tool call: who, org, client, tool, outcome. Arguments are not stored (they may hold brand material). */
export async function logToolCall(db: Db, row: { orgId: string | null; userId: string; clientId: string; tool: string; error?: string }) {
  await db.insert(mcpToolCalls).values({ id: crypto.randomUUID(), ...row, ok: row.error ? "error" : "ok", error: row.error ?? null });
}

export async function recentToolCalls(db: Db, ctx: OrgContext, limit = 20) {
  return db.select().from(mcpToolCalls).where(and(eq(mcpToolCalls.orgId, ctx.orgId), eq(mcpToolCalls.userId, ctx.userId))).orderBy(desc(mcpToolCalls.createdAt)).limit(limit);
}
