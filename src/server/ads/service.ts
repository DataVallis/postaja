// Ad sets (TASK-021, spec §5.8): the owner or an editor describes one ad concept (networks, placements, objective,
// offer, landing page); Claude writes three copy variants with each network's fields; every field is checked against the
// network's limits, the brand's banned words and CTA buttons, with one automatic fix round. Copy can be edited and is
// checked again on save. Export: copy.csv, one row per network × placement × variant (images follow in part B).
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";
import { getBrandDetail } from "../brands/service";
import type { Db } from "../db/client";
import { slugify } from "@/lib/slug";
import { AD_NETWORKS, AD_OBJECTIVES, adMedia, adNetworks, adSets, formatPresets, posts, type AdCopyVariant, type AdNetwork } from "../db/schema";
import { cappedCall } from "../llm/call";
import { SpendCapError } from "../llm/spend";
import { LlmError, type LlmClient } from "../llm/types";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { adCopyRequest, adCopySchema } from "./ai";
import { checkAdCopy, isHard, textsOf, type NetworkSpec } from "./check";

export class AdError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "INVALID" | "BAD_STATE" | "NO_PLACEMENT" | "LANGUAGE", public readonly detail?: string) {
    super(code);
  }
}

export type AdNetworkInfo = NetworkSpec & { label: string; placements: { key: string; placement: string; width: number; height: number }[] };

/** The networks with their fields, CTA buttons and offered placements (enabled image presets only). */
export async function adNetworkInfo(db: Db, keys: readonly AdNetwork[] = AD_NETWORKS): Promise<AdNetworkInfo[]> {
  const rows = await db.select().from(adNetworks).where(inArray(adNetworks.key, [...keys]));
  const presetKeys = rows.flatMap((r) => r.placements);
  const presets = presetKeys.length
    ? await db.select().from(formatPresets).where(and(inArray(formatPresets.key, presetKeys), eq(formatPresets.enabled, true), eq(formatPresets.media, "image")))
    : [];
  return AD_NETWORKS.filter((k) => keys.includes(k)).flatMap((k) => {
    const r = rows.find((x) => x.key === k);
    if (!r) return [];
    return [{
      key: r.key, label: r.label, fields: r.fields, ctas: r.ctas,
      placements: r.placements.flatMap((p) => presets.filter((x) => x.key === p).map((x) => ({ key: x.key, placement: x.placement, width: x.width, height: x.height }))),
    }];
  });
}

const createInput = z.object({
  brandId: z.string().min(1),
  name: z.string().trim().max(120).default(""),
  objective: z.enum(AD_OBJECTIVES),
  networks: z.array(z.enum(AD_NETWORKS)).min(1).max(AD_NETWORKS.length),
  placements: z.array(z.string().max(80)).min(1).max(20),
  offer: z.string().trim().max(2000).default(""),
  landingUrl: z.string().trim().max(2000).optional(),
  brief: z.string().trim().max(4000).default(""),
  language: z.string().max(5).optional(),
});

type Deps = { llm: LlmClient; now?: Date };

/** Creates the ad set and writes its copy right away (one Claude call, plus one fix round when a limit is broken). */
export async function createAdSet(db: Db, deps: Deps, ctx: OrgContext, input: z.input<typeof createInput>): Promise<string> {
  const i = createInput.parse(input);
  const { brand } = await getBrandDetail(db, ctx, i.brandId).catch(() => { throw new AdError("NOT_FOUND"); });
  if (brand.archivedAt) throw new AdError("BAD_STATE");
  const language = i.language || brand.languages[0];
  if (!brand.languages.includes(language)) throw new AdError("LANGUAGE");
  let landingUrl: string | null = null;
  if (i.landingUrl) {
    const u = /^https?:\/\//i.test(i.landingUrl) ? i.landingUrl : `https://${i.landingUrl}`;
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
      landingUrl = parsed.toString();
    } catch {
      throw new AdError("INVALID", "landingUrl");
    }
  }
  const networks = [...new Set(i.networks)];
  const info = await adNetworkInfo(db, networks);
  const offered = new Set(info.flatMap((n) => n.placements.map((p) => p.key)));
  const placements = [...new Set(i.placements)].filter((p) => offered.has(p));
  if (!placements.length) throw new AdError("NO_PLACEMENT");
  const id = crypto.randomUUID();
  const name = i.name || (i.offer || i.brief || brand.name).split("\n")[0].slice(0, 80);
  await forOrg(db, ctx).insert(adSets, {
    id, brandId: brand.id, name, objective: i.objective, networks, placements, offer: i.offer, landingUrl, brief: i.brief, language, createdBy: ctx.userId,
  });
  await writeAdCopy(db, deps, ctx, id);
  return id;
}

type AdSetRow = typeof adSets.$inferSelect;

export async function getAdSet(db: Db, ctx: OrgContext, id: string): Promise<AdSetRow> {
  const [r] = (await forOrg(db, ctx).select(adSets, eq(adSets.id, id))) as AdSetRow[];
  if (!r) throw new AdError("NOT_FOUND");
  return r;
}

export async function listAdSets(db: Db, ctx: OrgContext, brandId: string) {
  return (await forOrg(db, ctx).select(adSets, eq(adSets.brandId, brandId)).orderBy(desc(adSets.createdAt)).limit(100)) as AdSetRow[];
}

/** Keeps only the fields of the chosen networks, as texts (lists for multi-text fields). */
function normalize(raw: unknown, specs: NetworkSpec[]): AdCopyVariant[] {
  const variants = (raw as { variants?: unknown[] })?.variants ?? (Array.isArray(raw) ? raw : []);
  return variants.map((v) => {
    const out: AdCopyVariant = {};
    for (const s of specs) {
      const src = ((v as Record<string, unknown>)?.[s.key] ?? {}) as Record<string, unknown>;
      const net: Record<string, string | string[]> = {};
      for (const f of s.fields) {
        const val = src[f.key];
        net[f.key] = f.max > 1 ? textsOf(Array.isArray(val) ? val.map(String) : typeof val === "string" ? val.split("\n") : []) : String(typeof val === "string" ? val : "").trim();
      }
      if (s.ctas.length) net.cta = String(src.cta ?? "").trim();
      out[s.key] = net;
    }
    return out;
  });
}

/**
 * (Re)writes the copy. Expected failures (spend cap, provider, invalid answers) are stored on the ad set as `error`
 * (status draft) so the page can say what happened and offer a retry; nothing is thrown for them.
 */
export async function writeAdCopy(db: Db, deps: Deps, ctx: OrgContext, id: string) {
  const a = await getAdSet(db, ctx, id);
  const { brand, profile } = await getBrandDetail(db, ctx, a.brandId);
  const specs = (await adNetworkInfo(db, a.networks)).map(({ key, fields, ctas }) => ({ key, fields, ctas }));
  const recent = ((await forOrg(db, ctx).select(posts, and(eq(posts.brandId, brand.id), notInArray(posts.status, ["skipped", "failed"]))!)
    .orderBy(desc(posts.createdAt)).limit(30)) as (typeof posts.$inferSelect)[])
    .map((p) => (p.topicSummary || (p.plan as { topic?: string } | null)?.topic || p.brief).slice(0, 200));
  const inputs = {
    brandName: brand.name, language: a.language, cgp: profile?.cgp ?? "", objective: a.objective, offer: a.offer,
    landingUrl: a.landingUrl, brief: a.brief, networks: specs, recent,
  };
  const banned = profile?.rules.bannedWords ?? [];
  const schema = adCopySchema(specs);
  const fail = (error: string) => forOrg(db, ctx).update(adSets, { status: "draft", error: error.slice(0, 300), updatedAt: new Date() }, eq(adSets.id, id));
  let fix: { draft: unknown; issues: ReturnType<typeof checkAdCopy> } | undefined;
  let best: { copy: AdCopyVariant[]; issues: ReturnType<typeof checkAdCopy>; model: string } | null = null;
  for (let round = 0; round < 2; round++) {
    let out;
    try {
      out = await cappedCall(db, deps.llm, { orgId: ctx.orgId, brandId: brand.id, postId: null, now: deps.now }, adCopyRequest(inputs, fix));
    } catch (e) {
      if (best) break; // keep the first draft; its issues are shown
      if (e instanceof SpendCapError) return fail("SPEND_CAP");
      if (e instanceof LlmError) return fail(e.code === "NOT_CONFIGURED" ? "NO_MODEL" : `AI_FAILED:${e.message}`);
      throw e;
    }
    const parsed = schema.safeParse(out.input);
    if (!parsed.success) {
      if (best) break;
      fix = { draft: out.input, issues: [] };
      if (round === 1) return fail("AI_FAILED:INVALID_OUTPUT");
      continue;
    }
    const copy = normalize(parsed.data, specs);
    const issues = checkAdCopy(copy, specs, banned);
    best = { copy, issues, model: out.model ?? "" };
    if (!issues.some(isHard)) break;
    fix = { draft: parsed.data, issues: issues.filter(isHard) };
  }
  if (!best) return fail("AI_FAILED:INVALID_OUTPUT");
  await forOrg(db, ctx).update(adSets, {
    copy: best.copy, issues: best.issues, status: best.issues.some(isHard) ? "needs_review" : "ready", model: best.model || null, error: null, updatedAt: new Date(),
  }, eq(adSets.id, id));
}

const copyInput = z.array(z.record(z.string(), z.record(z.string(), z.union([z.string().max(5000), z.array(z.string().max(5000)).max(10)])))).max(5);

/** The owner or an editor corrects the copy; it is checked again (ready / needs_review). */
export async function saveAdCopy(db: Db, ctx: OrgContext, id: string, copy: z.input<typeof copyInput>) {
  const raw = copyInput.parse(copy);
  const a = await getAdSet(db, ctx, id);
  const { profile } = await getBrandDetail(db, ctx, a.brandId);
  const specs = (await adNetworkInfo(db, a.networks)).map(({ key, fields, ctas }) => ({ key, fields, ctas }));
  const normalized = normalize(raw, specs);
  const issues = checkAdCopy(normalized, specs, profile?.rules.bannedWords ?? []);
  await forOrg(db, ctx).update(adSets, { copy: normalized, issues, status: issues.some(isHard) ? "needs_review" : "ready", updatedAt: new Date() }, eq(adSets.id, id));
}

export const adSlug = (a: { id: string; name: string }) => (slugify(a.name) || a.id.slice(0, 8)).slice(0, 40);
/** `<brand>_<adset>_<placement>_v<n>.png` (spec §5.8). */
export const creativeName = (brandSlug: string, a: { id: string; name: string }, placement: string, variant: number) =>
  `${brandSlug}_${adSlug(a)}_${placement}_v${variant + 1}.png`;

const csvCell = (v: string) => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** copy.csv: one row per network × placement × variant, every field as a column (lists joined with " | "). */
export async function adCopyCsv(db: Db, ctx: OrgContext, id: string): Promise<{ filename: string; csv: string }> {
  const a = await getAdSet(db, ctx, id);
  const info = await adNetworkInfo(db, a.networks);
  const fieldKeys = [...new Set(info.flatMap((n) => n.fields.map((f) => f.key)))];
  const { brand } = await getBrandDetail(db, ctx, a.brandId);
  // The image file of each row, once creatives exist (as named in the ZIP: <placement>/<file>).
  const made = new Set((await forOrg(db, ctx).select(adMedia, and(eq(adMedia.adSetId, id), eq(adMedia.kind, "creative"))!) as (typeof adMedia.$inferSelect)[]).map((m) => `${m.placement}|${m.variant}`));
  const head = ["ad_set", "network", "placement", "width", "height", "variant", ...fieldKeys, "cta", "landing_url", "image_file"];
  const rows: string[][] = [];
  for (const n of info) {
    for (const p of n.placements.filter((x) => a.placements.includes(x.key))) {
      a.copy.forEach((v, i) => {
        const c = v[n.key] ?? {};
        rows.push([a.name, n.key, p.key, String(p.width), String(p.height), String(i + 1), ...fieldKeys.map((k) => textsOf(c[k]).join(" | ")), typeof c.cta === "string" ? c.cta : "", a.landingUrl ?? "",
          made.has(`${p.key}|${i}`) ? `${p.key}/${creativeName(brand.slug, a, p.key, i)}` : ""]);
      });
    }
  }
  // BOM + ";" so Excel opens it in Slovenian locales (same as the day overview, TASK-016).
  return { filename: `${brand.slug}-oglas-${id.slice(0, 8)}-copy.csv`, csv: `﻿${[head, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n")}\r\n` };
}
