// What a bulk run will cost, shown before it starts (owner, 2026-10-07: "pred zagonom prikaz, koliko bo stalo").
// An estimate from the real inputs — brand CGP and material size, the brand's Claude model, each post's slides, the
// brand's design and its image model — with an expected figure and an upper bound. The upper bound is what the spend
// cap reserves in the worst case (full output, the one allowed fix/retry round, an illustration on every image).
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { brandDesigns, brandProfileVersions, brands, brandSources, modelRegistry, orgSettings, posts, type BulkScope, type BulkStep } from "../db/schema";
import { needsIllustration } from "../design/spec";
import { billedMegapixels, generationSize } from "../images/fal";
import { MAX_SLIDES } from "../design/ai";
import { worstCaseMicroUsd, type Prices } from "../llm/cost";
import { textModelFor } from "../llm/call";
import { monthToDate } from "../llm/spend";
import { MAX_OUTPUT_TOKENS } from "../posts/generate";
import type { OrgContext } from "../tenancy/context";
import { bulkCandidates } from "./service";

/** Prompt parts that do not depend on the brand (system text, channel block, plan of one post), in characters. */
const TEXT_FIXED_CHARS = 6_000;
/** Materials go into a post's prompt up to this many characters (ADR-039). */
const MATERIALS_MAX = 60_000;
/** A typical caption with hashtags, in tokens (the expected case; the upper bound uses MAX_OUTPUT_TOKENS). */
const TEXT_TYPICAL_OUT = 900;
/** Image planning call: templates + the post, and Claude's answer. */
const PLAN_FIXED_CHARS = 5_000;
const PLAN_TYPICAL_OUT = 1_200;
const PLAN_MAX_OUT = 4_000;

const perMtok = (tokens: number, price: bigint) => (BigInt(tokens) * price + 999_999n) / 1_000_000n;
/** The expected cost of one call: input at the normal input price (1 token ≈ 3 characters), a typical answer. */
const expectedCall = (inputChars: number, outTokens: number, p: Prices) => perMtok(Math.ceil(inputChars / 3), p.inputPerMtok) + perMtok(outTokens, p.outputPerMtok);

export type BulkEstimate = {
  text: { posts: number; expected: bigint; max: bigint; model: string | null };
  image: { posts: number; images: number; illustrations: number; illustrationsMax: number; expected: bigint; max: bigint; model: string | null; noDesign: number };
  expected: bigint;
  max: bigint;
  budget: { cap: bigint | null; spent: bigint; left: bigint | null };
  /** True when the upper bound does not fit what is left of this month's cap: the run may stop part-way. */
  overBudget: boolean;
};

type BrandFacts = { prices: Prices | null; label: string | null; inputChars: number; illustrationShare: number; templateChars: number; hasDesign: boolean; hasExamples: boolean };

async function brandFacts(db: Db, ctx: OrgContext, brandId: string): Promise<BrandFacts> {
  const [b] = await db
    .select({ cgp: brandProfileVersions.cgp, designId: brands.currentDesignId })
    .from(brands)
    .leftJoin(brandProfileVersions, eq(brandProfileVersions.id, brands.currentProfileVersionId))
    .where(and(eq(brands.id, brandId), eq(brands.orgId, ctx.orgId)));
  const [{ chars, examples }] = await db
    .select({
      chars: sql<number>`coalesce(sum((${brandSources.extract}->>'chars')::int), 0)::int`,
      examples: sql<number>`count(*) filter (where ${brandSources.kind} = 'image')::int`,
    })
    .from(brandSources)
    .where(and(eq(brandSources.orgId, ctx.orgId), eq(brandSources.brandId, brandId)));
  const model = await textModelFor(db, brandId).catch(() => null);
  let illustrationShare = 1;
  let templateChars = 0;
  if (b?.designId) {
    const [d] = await db.select({ spec: brandDesigns.spec }).from(brandDesigns).where(eq(brandDesigns.id, b.designId));
    if (d?.spec) {
      const ts = d.spec.templates;
      illustrationShare = ts.length ? ts.filter(needsIllustration).length / ts.length : 0;
      templateChars = JSON.stringify(ts).length;
    }
  }
  return {
    prices: model, label: model?.label ?? null, inputChars: TEXT_FIXED_CHARS + (b?.cgp?.length ?? 0) + Math.min(chars, MATERIALS_MAX),
    illustrationShare, templateChars, hasDesign: !!b?.designId, hasExamples: examples > 0,
  };
}

async function imageModel(db: Db, kind: "image" | "image_style") {
  const [m] = await db.select().from(modelRegistry).where(and(eq(modelRegistry.kind, kind), eq(modelRegistry.isDefault, true), eq(modelRegistry.enabled, true)));
  return m;
}

/** Images a post gets: one per slide of a carousel (plus a cover the plan may lack), else one. */
export function imagesFor(plan: { slides?: unknown[]; slideCount?: number } | null, format: string | null): { expected: number; max: number } {
  const slides = plan?.slides?.length || plan?.slideCount || 0;
  if (format === "carousel" || slides > 1) {
    const n = Math.max(slides, 2);
    return { expected: Math.min(n, MAX_SLIDES), max: Math.min(n + 1, MAX_SLIDES) };
  }
  return { expected: 1, max: 1 };
}

export async function estimateBulk(db: Db, ctx: OrgContext, scope: BulkScope, steps: BulkStep[], now = new Date()): Promise<BulkEstimate> {
  const ids = { text: steps.includes("text") ? await bulkCandidates(db, ctx, scope, "text") : [], image: steps.includes("image") ? await bulkCandidates(db, ctx, scope, "image") : [] };
  // Posts that will get text in this run can also get images in it, though their brand has no design yet → counted apart.
  const all = [...new Set([...ids.text, ...ids.image])];
  const rows = all.length
    ? await db.select({ id: posts.id, brandId: posts.brandId, plan: posts.plan, format: posts.format }).from(posts).where(and(eq(posts.orgId, ctx.orgId), inArray(posts.id, all)))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const facts = new Map<string, BrandFacts>();
  const factsFor = async (brandId: string) => {
    if (!facts.has(brandId)) facts.set(brandId, await brandFacts(db, ctx, brandId));
    return facts.get(brandId)!;
  };

  const text = { posts: ids.text.length, expected: 0n, max: 0n, model: null as string | null };
  for (const id of ids.text) {
    const f = await factsFor(byId.get(id)!.brandId);
    if (!f.prices) continue;
    text.model ??= f.label;
    text.expected += expectedCall(f.inputChars, TEXT_TYPICAL_OUT, f.prices);
    text.max += 2n * worstCaseMicroUsd(f.inputChars, MAX_OUTPUT_TOKENS, f.prices); // one fix round at most (ADR-036)
  }

  // With "text" and "image" together, posts written in this run get images too when their brand has a design.
  const imageIds = steps.includes("image") ? [...new Set([...ids.image, ...ids.text])] : [];
  const image = { posts: 0, images: 0, illustrations: 0, illustrationsMax: 0, expected: 0n, max: 0n, model: null as string | null, noDesign: 0 };
  const [plain, styled] = imageIds.length ? await Promise.all([imageModel(db, "image"), imageModel(db, "image_style")]) : [undefined, undefined];
  const mp = billedMegapixels(generationSize(1080, 1350).width, generationSize(1080, 1350).height);
  for (const id of imageIds) {
    const p = byId.get(id) ?? (await db.select({ id: posts.id, brandId: posts.brandId, plan: posts.plan, format: posts.format }).from(posts).where(eq(posts.id, id)))[0];
    const f = await factsFor(p.brandId);
    if (!f.hasDesign) { image.noDesign++; continue; }
    const n = imagesFor(p.plan as { slides?: unknown[]; slideCount?: number } | null, p.format);
    image.posts++;
    image.images += n.expected;
    const ill = Math.round(n.expected * f.illustrationShare);
    image.illustrations += ill;
    image.illustrationsMax += n.max;
    const m = (f.hasExamples ? styled : undefined) ?? plain;
    const each = m ? m.perImage + BigInt(mp) * m.perMegapixel : 0n;
    if (m) image.model ??= m.label;
    if (f.prices) {
      const chars = PLAN_FIXED_CHARS + f.templateChars;
      image.expected += expectedCall(chars, PLAN_TYPICAL_OUT, f.prices);
      image.max += 2n * worstCaseMicroUsd(chars, PLAN_MAX_OUT, f.prices); // one retry on an invalid answer
    }
    image.expected += BigInt(ill) * each;
    image.max += BigInt(n.max) * each;
  }

  const [s] = await db.select({ cap: orgSettings.spendCapMicroUsd }).from(orgSettings).where(eq(orgSettings.orgId, ctx.orgId));
  const cap = s?.cap ?? null;
  const spent = await monthToDate(db, ctx.orgId, now);
  const left = cap === null ? null : cap > spent ? cap - spent : 0n;
  const expected = text.expected + image.expected;
  const max = text.max + image.max;
  return { text, image, expected, max, budget: { cap, spent, left }, overBudget: left !== null && max > left };
}

