// Super-admin edits of global platform data (TASK-004b, spec §4.2/§5.9/§11, ADR-020/022/030/032).
// Every change: super admin only, validated, row-locked, one audit row with from → to per changed field.
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { auditLog, formatPresets, platformRules, PLATFORMS, type Platform } from "../db/schema";
import { ForbiddenError, type Actor } from "../orgs/service";
import { todayIso } from "./verification";

const MAX_INT = 1_000_000_000;
const limit = (min: number) => z.number().int().min(min).max(MAX_INT).nullable();

/** Provenance fields every row carries (ADR-030). verifiedAt may be today but never in the future. */
const provenance = (now: Date) => ({
  source: z.string().trim().min(3).max(500),
  confidence: z.enum(["high", "medium", "low"]),
  notes: z.string().trim().max(2000).nullable().transform((v) => (v ? v : null)),
  verifiedAt: z.iso.date().refine((d) => d <= todayIso(now), { message: "verified_in_future" }),
});

export const platformRuleInput = (now: Date) =>
  z
    .object({
      counting: z.enum(["graphemes", "x_weighted"]),
      captionMax: limit(1),
      visibleChars: limit(1),
      hashtagsMax: limit(0),
      mentionsMax: limit(0),
      linksClickable: z.boolean(),
      threadPartMax: limit(1),
      threadPartsMax: limit(1),
      slidesMin: limit(1),
      slidesMax: limit(1),
      ...provenance(now),
    })
    .strict()
    .refine((r) => r.visibleChars === null || r.captionMax === null || r.visibleChars <= r.captionMax, { path: ["visibleChars"] })
    .refine((r) => r.slidesMin === null || r.slidesMax === null || r.slidesMin <= r.slidesMax, { path: ["slidesMin"] });

export const formatPresetInput = (now: Date) =>
  z
    .object({
      width: z.number().int().min(1).max(20_000),
      height: z.number().int().min(1).max(20_000),
      maxBytes: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable(),
      minDurationS: z.number().int().min(0).max(86_400).nullable(),
      maxDurationS: z.number().int().min(1).max(86_400).nullable(),
      safeZone: z.object({ top: z.number().int().min(0), right: z.number().int().min(0), bottom: z.number().int().min(0), left: z.number().int().min(0) }).strict(),
      enabled: z.boolean(),
      ...provenance(now),
    })
    .strict()
    .refine((p) => p.minDurationS === null || p.maxDurationS === null || p.minDurationS <= p.maxDurationS, { path: ["minDurationS"] })
    // The safe zone must leave at least one usable pixel in each direction.
    .refine((p) => p.safeZone.top + p.safeZone.bottom < p.height && p.safeZone.left + p.safeZone.right < p.width, { path: ["safeZone"] });

export type PlatformRuleInput = z.input<ReturnType<typeof platformRuleInput>>;
export type FormatPresetInput = z.input<ReturnType<typeof formatPresetInput>>;

// Objects are compared with sorted keys: jsonb returns keys in its own order, which must not count as a change.
const sortedJson = (o: object) => JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))));
const show = (v: unknown) => (v === null || v === undefined ? null : typeof v === "object" ? sortedJson(v) : String(v));

/** Field-level diff for the audit row; only changed fields. */
function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { from: string | null; to: string | null }> = {};
  for (const k of Object.keys(after)) {
    const from = show(before[k]);
    const to = show(after[k]);
    if (from !== to) out[k] = { from, to };
  }
  return out;
}

function requireSuperadmin(actor: Actor) {
  if (actor.role !== "superadmin") throw new ForbiddenError();
}

/** Replace the editable fields of one platform's rules. Returns the changed fields (empty → nothing written). */
export async function updatePlatformRule(db: Db, actor: Actor, platform: Platform, input: PlatformRuleInput, now = new Date()) {
  requireSuperadmin(actor);
  z.enum(PLATFORMS).parse(platform);
  const data = platformRuleInput(now).parse(input);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(platformRules).where(eq(platformRules.platform, platform)).for("update");
    if (!before) throw new Error("NOT_FOUND");
    const changes = diff(before, data);
    if (Object.keys(changes).length === 0) return changes;
    await tx.update(platformRules).set({ ...data, updatedAt: sql`now()` }).where(eq(platformRules.platform, platform));
    await tx.insert(auditLog).values({ id: crypto.randomUUID(), actorUserId: actor.userId, orgId: null, action: "platform_rule.update", target: platform, meta: changes });
    return changes;
  });
}

/** Replace the editable fields of one format preset (key, platform, placement and media stay fixed). */
export async function updateFormatPreset(db: Db, actor: Actor, key: string, input: FormatPresetInput, now = new Date()) {
  requireSuperadmin(actor);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(formatPresets).where(eq(formatPresets.key, key)).for("update");
    if (!before) throw new Error("NOT_FOUND");
    const data = formatPresetInput(now).parse(input);
    const changes = diff(before, data);
    if (Object.keys(changes).length === 0) return changes;
    await tx.update(formatPresets).set({ ...data, updatedAt: sql`now()` }).where(eq(formatPresets.key, key));
    await tx.insert(auditLog).values({ id: crypto.randomUUID(), actorUserId: actor.userId, orgId: null, action: "format_preset.update", target: key, meta: changes });
    return changes;
  });
}
