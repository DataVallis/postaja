// Demo from a website (TASK-040, ADR-070). A super admin enters a prospect's website (and, when the site cannot be read,
// pastes its text). The demo is built in the background in the sales organization "Data Vallis – prodaja" (its own spend
// cap): Claude reads the home page as data and drafts a brand (CGP, pillars, colours, 3 posts, 1 ad concept); Postaja
// stores the logo, pictures and page text as the brand's files, makes the brand design, writes the posts, draws their
// images and writes and draws the ad set — with the same services members use. A public read-only link (only its hash
// is stored) shows the result for 14 days. Whatever could not be made is noted; nothing made is thrown away.
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { addDays, isoWeekday, todayIn } from "@/lib/dates";
import { addChannel, createBrandNamed, getBrandDetail, saveProfile } from "../brands/service";
import { uploadBrandFile } from "../brands/files";
import { publicUrl } from "../competitors/ai";
import { issues } from "../design/ai";
import { requestDesign, runDesignJob, type DesignJob } from "../design/service";
import { adNetworkInfo, createAdSet, getAdSet } from "../ads/service";
import { requestAdImages, runAdImageJob, type AdImageJob } from "../ads/creatives";
import type { Db } from "../db/client";
import { adMedia, adSets, auditLog, brandAssets, brandDesigns, brands, demos, member, organization, orgSettings, postMedia, posts, type DemoStep } from "../db/schema";
import { fetchPublicFile, FetchError, type FetchFile } from "../files/fetch-public";
import { MAX_INPUT_PIXELS } from "../files/images";
import type { Storage } from "../files/storage";
import type { ImageClient } from "../images/fal";
import { requestImages, runImageJob, type PostImageJob } from "../images/service";
import { cappedCall } from "../llm/call";
import { SpendCapError } from "../llm/spend";
import { LlmError, type LlmClient } from "../llm/types";
import type { Actor } from "../orgs/service";
import { generateForPost } from "../posts/generate";
import { resolveOrgContext, TenancyError, type OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { demoRequest, demoSchema, type DemoPlan } from "./ai";
import { readSite } from "./site";

export const DEMO_QUEUE = "demo-build";
export type DemoJob = { demoId: string };
export const SALES_ORG = { slug: "data-vallis-prodaja", name: "Data Vallis – prodaja" } as const;
/** The sales organization's own monthly spend cap (micro-USD); the super admin can change it on its admin page. */
export const SALES_SPEND_CAP_MICRO_USD = 30_000_000n;
export const DEMO_LINK_DAYS = 14;
export const DEMOS_PER_DAY = 20;
export const PASTED_MAX = 20_000;
const PAGE_MAX_BYTES = 3 * 1024 * 1024;
const PICTURE_MAX_BYTES = 8 * 1024 * 1024;
const TEXT_MIN = 100;

export class DemoError extends Error {
  constructor(public readonly code: "INVALID" | "NOT_FOUND" | "GONE" | "TOO_MANY") {
    super(code);
  }
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const audit = (db: Db, actor: Actor, action: string, orgId: string | null, target: string, meta: Record<string, unknown> = {}) =>
  db.insert(auditLog).values({ id: crypto.randomUUID(), actorUserId: actor.userId, orgId, action, target, meta });

function requireSuperadmin(actor: Actor) {
  if (actor.role !== "superadmin") throw new DemoError("NOT_FOUND");
}

/** The sales organization (created on first use, the super admin as owner; another super admin joins as owner). */
export async function ensureSalesOrg(db: Db, actor: Actor): Promise<string> {
  requireSuperadmin(actor);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('postaja.sales-org'))`);
    let [org] = await tx.select({ id: organization.id }).from(organization).where(eq(organization.slug, SALES_ORG.slug));
    if (!org) {
      org = { id: crypto.randomUUID() };
      await tx.insert(organization).values({ id: org.id, name: SALES_ORG.name, slug: SALES_ORG.slug });
      await tx.insert(orgSettings).values({ orgId: org.id, plan: "comped", spendCapMicroUsd: SALES_SPEND_CAP_MICRO_USD });
      await audit(tx as unknown as Db, actor, "demo.sales_org", org.id, SALES_ORG.slug, { spendCapMicroUsd: String(SALES_SPEND_CAP_MICRO_USD) });
    }
    const [m] = await tx.select({ id: member.id }).from(member).where(and(eq(member.organizationId, org.id), eq(member.userId, actor.userId)));
    if (!m) await tx.insert(member).values({ id: crypto.randomUUID(), organizationId: org.id, userId: actor.userId, role: "owner" });
    return org.id;
  });
}

const startInput = z.object({
  url: publicUrl,
  name: z.string().trim().max(80).default(""),
  text: z.string().trim().max(PASTED_MAX).default(""),
});

/** Super admin: queues a demo for `url`; returns the share link's token (shown once). */
export async function startDemo(db: Db, queue: { send(name: string, data: object, key: string): Promise<void> }, actor: Actor, input: z.input<typeof startInput>, now = new Date()) {
  requireSuperadmin(actor);
  const r = startInput.safeParse(input);
  if (!r.success) throw new DemoError("INVALID");
  const orgId = await ensureSalesOrg(db, actor);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(demos).where(and(eq(demos.orgId, orgId), gte(demos.createdAt, new Date(now.getTime() - 86_400_000))));
  if (n >= DEMOS_PER_DAY) throw new DemoError("TOO_MANY");
  const id = crypto.randomUUID();
  const token = newToken();
  await db.insert(demos).values({
    id, orgId, url: r.data.url, nameHint: r.data.name, pastedText: r.data.text, tokenHash: hash(token),
    expiresAt: new Date(now.getTime() + DEMO_LINK_DAYS * 86_400_000), createdBy: actor.userId, createdAt: now, updatedAt: now,
  });
  await audit(db, actor, "demo.create", orgId, id, { url: r.data.url });
  await queue.send(DEMO_QUEUE, { demoId: id } satisfies DemoJob, `demo:${id}`);
  return { id, token };
}

/** Super admin: the demos, newest first, with their brand's name. */
export async function listDemos(db: Db, actor: Actor, limit = 100) {
  requireSuperadmin(actor);
  return db.select({ demo: demos, brandName: brands.name }).from(demos).leftJoin(brands, eq(brands.id, demos.brandId))
    .orderBy(desc(demos.createdAt)).limit(limit);
}

/** Super admin: the demo's brand and organization (the super admin becomes a member of the sales org when needed). */
export async function demoBrandFor(db: Db, actor: Actor, id: string) {
  requireSuperadmin(actor);
  const [d] = await db.select({ orgId: demos.orgId, brandId: demos.brandId }).from(demos).where(eq(demos.id, id));
  if (!d?.brandId) throw new DemoError("NOT_FOUND");
  await ensureSalesOrg(db, actor);
  return { orgId: d.orgId, brandId: d.brandId };
}

/** Super admin: a new share link for 14 more days (the old one stops working). */
export async function newDemoLink(db: Db, actor: Actor, id: string, now = new Date()) {
  requireSuperadmin(actor);
  const token = newToken();
  const done = await db.update(demos).set({ tokenHash: hash(token), expiresAt: new Date(now.getTime() + DEMO_LINK_DAYS * 86_400_000), revokedAt: null, updatedAt: now })
    .where(eq(demos.id, id)).returning({ orgId: demos.orgId });
  if (!done.length) throw new DemoError("NOT_FOUND");
  await audit(db, actor, "demo.link", done[0].orgId, id);
  return { token };
}

/** Super admin: the share link stops working at once (the demo brand stays in the sales organization). */
export async function revokeDemoLink(db: Db, actor: Actor, id: string, now = new Date()) {
  requireSuperadmin(actor);
  const done = await db.update(demos).set({ revokedAt: now, updatedAt: now }).where(and(eq(demos.id, id), isNull(demos.revokedAt))).returning({ orgId: demos.orgId });
  if (!done.length) throw new DemoError("NOT_FOUND");
  await audit(db, actor, "demo.revoke", done[0].orgId, id);
}

// ---- Building (worker) -------------------------------------------------------------------------------------------

export type DemoDeps = { llm: LlmClient; images: ImageClient | null; storage: Storage; fetchFile?: FetchFile; now?: Date };

/** Runs a queued job right here (the demo job drives the other workers' steps itself, one after another). */
function inline<T>() {
  const jobs: T[] = [];
  return { jobs, queue: { async send(_name: string, data: object) { jobs.push(data as T); } } };
}

const errorCode = (e: unknown): string => {
  if (e instanceof SpendCapError) return "SPEND_CAP";
  if (e instanceof LlmError) return e.code;
  if (e instanceof FetchError) return e.code;
  const c = (e as { code?: unknown })?.code;
  return typeof c === "string" && /^[A-Z_]{2,40}$/.test(c) ? c : "FAILED";
};

/** An SVG logo as PNG; links to anything outside the file are removed first, so nothing is fetched while drawing. */
async function svgToPng(bytes: Uint8Array): Promise<Uint8Array> {
  const svg = new TextDecoder().decode(bytes)
    .replace(/<image\b[\s\S]*?(\/>|<\/image>)/gi, "")
    .replace(/\s(xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, "")
    .replace(/@import[^;]*;/gi, "")
    .replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, "none");
  return new Uint8Array(await sharp(Buffer.from(svg), { limitInputPixels: MAX_INPUT_PIXELS, density: 300 }).resize(1200, 1200, { fit: "inside", withoutEnlargement: false }).png().toBuffer());
}

/** Shares rounded to add up to at most 100; names made unique. */
function pillarsOf(plan: DemoPlan) {
  const seen = new Set<string>();
  const list = plan.pillars.filter((p) => !seen.has(p.name.toLowerCase()) && seen.add(p.name.toLowerCase()));
  const sum = list.reduce((s, p) => s + p.share, 0);
  return list.map((p) => ({ ...p, share: sum > 100 ? Math.floor((p.share * 100) / sum) : p.share }));
}

/** The next `n` weekdays after `today` (the demo's posts get a plausible week). */
function nextWeekdays(today: string, n: number): string[] {
  const out: string[] = [];
  for (let d = addDays(today, 1); out.length < n; d = addDays(d, 1)) if (isoWeekday(d) <= 5) out.push(d);
  return out;
}

/** Builds the demo. Expected failures end as status "failed" with a code; partial results are kept and noted. */
export async function runDemoJob(db: Db, deps: DemoDeps, job: DemoJob): Promise<"ready" | "failed" | "skipped"> {
  const claimed = await db.update(demos).set({ status: "running", updatedAt: new Date() }).where(and(eq(demos.id, job.demoId), eq(demos.status, "queued"))).returning();
  const d = claimed[0];
  if (!d) return "skipped";
  const warnings: string[] = [];
  const step = (s: DemoStep, extra: Partial<typeof demos.$inferInsert> = {}) => db.update(demos).set({ step: s, warnings, updatedAt: new Date(), ...extra }).where(eq(demos.id, d.id));
  const fail = async (code: string) => {
    await db.update(demos).set({ status: "failed", error: code, warnings, updatedAt: new Date() }).where(eq(demos.id, d.id));
    return "failed" as const;
  };
  if (!d.createdBy) return fail("NO_ACCESS");
  let ctx: OrgContext;
  try {
    ctx = await resolveOrgContext(db, { userId: d.createdBy, activeOrganizationId: d.orgId });
  } catch (e) {
    if (e instanceof TenancyError) return fail("NO_ACCESS");
    throw e;
  }
  try {
    return await build(db, deps, ctx, d, warnings, step, fail);
  } catch (e) {
    console.error("[demo]", d.id, e instanceof Error ? e.message.slice(0, 200) : "error");
    return fail(errorCode(e));
  }
}

async function build(
  db: Db, deps: DemoDeps, ctx: OrgContext, d: typeof demos.$inferSelect, warnings: string[],
  step: (s: DemoStep, extra?: Partial<typeof demos.$inferInsert>) => Promise<unknown>, fail: (code: string) => Promise<"failed">,
): Promise<"ready" | "failed"> {
  const fetchFile = deps.fetchFile ?? fetchPublicFile;
  const warn = (what: string, e: unknown) => warnings.push(`${what}:${errorCode(e)}`);

  // 1. The home page: text, logo, pictures, colours. The pasted text (if any) stands in when the page cannot be read.
  let site = { title: "", text: "", logoUrl: null as string | null, imageUrls: [] as string[], colors: [] as string[] };
  try {
    const f = await fetchFile(d.url, { maxBytes: PAGE_MAX_BYTES, timeoutMs: 20_000 });
    const html = new TextDecoder("utf-8", { fatal: false }).decode(f.bytes);
    if (!/html/i.test(f.contentType ?? "") && !/^\s*</.test(html)) throw Object.assign(new Error("not html"), { code: "NOT_HTML" });
    site = readSite(html, d.url);
  } catch (e) {
    warn("SITE", e);
  }
  const text = [site.text, d.pastedText].filter(Boolean).join("\n\n");
  if (text.length < TEXT_MIN) return fail(warnings.find((w) => w.startsWith("SITE:"))?.slice(5) ?? "NO_TEXT");
  let logo: Uint8Array | null = null;
  if (site.logoUrl) {
    try {
      const f = await fetchFile(site.logoUrl, { maxBytes: PICTURE_MAX_BYTES, timeoutMs: 15_000 });
      logo = /svg/i.test(f.contentType ?? "") || /^\s*(<\?xml|<svg)/i.test(new TextDecoder().decode(f.bytes.slice(0, 200))) ? await svgToPng(f.bytes) : f.bytes;
    } catch (e) {
      warn("LOGO", e);
    }
  }

  // 2. Claude drafts the brand from the page (data, not instructions); one retry when the answer is invalid.
  await step("brand");
  let plan: DemoPlan | null = null;
  let invalid: { draft: unknown; errors: string } | undefined;
  for (let attempt = 0; attempt < 2 && !plan; attempt++) {
    let out;
    try {
      out = await cappedCall(db, deps.llm, { orgId: ctx.orgId, brandId: null, postId: null, now: deps.now }, demoRequest({ url: d.url, nameHint: d.nameHint, title: site.title, text, colors: site.colors, hasLogo: !!logo }, invalid));
    } catch (e) {
      if (e instanceof SpendCapError || e instanceof LlmError) return fail(errorCode(e));
      throw e;
    }
    const parsed = demoSchema.safeParse(out.input);
    if (parsed.success) plan = parsed.data;
    else invalid = { draft: out.input, errors: issues(parsed.error) };
  }
  if (!plan) return fail("INVALID_OUTPUT");
  const name = (d.nameHint || plan.name).slice(0, 80);
  const { id: brandId } = await createBrandNamed(db, ctx, { name: name.length >= 2 ? name : plan.name, website: new URL(d.url).origin, languages: [plan.language] });
  await step("brand", { brandId });
  await saveProfile(db, ctx, brandId, {
    cgp: plan.cgp, pillars: pillarsOf(plan), note: "demo",
    rules: { bannedWords: [], ctaPhrases: [], regexMust: [], regexMustNot: [] },
    visual: { colors: plan.colors, imageStyle: plan.imageStyle, negativePrompt: "" },
  });
  const { id: channelId } = await addChannel(db, ctx, brandId, {
    platform: "instagram", handle: `@${new URL(d.url).hostname.replace(/^www\./, "").split(".")[0]}`.slice(0, 80), language: plan.language,
    goal: { postsPerDay: 1, weekdays: [1, 2, 3, 4, 5] }, allowedTypes: ["single_image", "carousel"],
  });
  if (logo) await uploadBrandFile(db, deps.storage, ctx, brandId, "logo", { filename: "logo.png", bytes: logo }).catch((e) => warn("LOGO", e));
  for (const [i, u] of site.imageUrls.entries()) {
    try {
      const f = await fetchFile(u, { maxBytes: PICTURE_MAX_BYTES, timeoutMs: 15_000 });
      await uploadBrandFile(db, deps.storage, ctx, brandId, "source", { filename: `slika-${i + 1}.${/png/i.test(f.contentType ?? "") ? "png" : "jpg"}`, bytes: f.bytes });
    } catch {
      // A picture that cannot be fetched or read is simply left out.
    }
  }
  await uploadBrandFile(db, deps.storage, ctx, brandId, "source", { filename: "spletna-stran.md", bytes: new TextEncoder().encode(`# ${site.title || name}\n\n${d.url}\n\n${text}`) })
    .catch((e) => warn("TEXT", e));

  // 3. The brand design (needed for images). Without it the demo still has its texts.
  await step("design");
  let design = false;
  try {
    const q = inline<DesignJob>();
    await requestDesign(db, q.queue, ctx, brandId, { brief: plan.imageStyle });
    for (const j of q.jobs) design = (await runDesignJob(db, deps, j)) === "ready";
    if (!design) {
      const [row] = await db.select({ error: brandDesigns.error }).from(brandDesigns).where(eq(brandDesigns.brandId, brandId)).orderBy(desc(brandDesigns.createdAt)).limit(1);
      warnings.push(`DESIGN:${row?.error?.split(":")[0] ?? "FAILED"}`);
    }
  } catch (e) {
    warn("DESIGN", e);
  }

  // 4. Three planned posts over the next weekdays, written like any planned post.
  await step("posts");
  const { profile } = await getBrandDetail(db, ctx, brandId);
  const days = nextWeekdays(todayIn(undefined, deps.now ?? new Date()), plan.posts.length);
  const postIds: string[] = [];
  for (const [i, p] of plan.posts.entries()) {
    const id = crypto.randomUUID();
    const slides = p.format === "carousel" ? p.slides : [];
    await forOrg(db, ctx).insert(posts, {
      id, brandId, channelId, profileVersionId: profile!.id, brief: p.topic, status: "planned", format: slides.length ? "carousel" : "image", scheduledOn: days[i],
      plan: { topic: p.topic, ...(p.category ? { category: p.category } : {}), ...(p.overlayText ? { overlayText: p.overlayText } : {}), ...(slides.length ? { slides, slideCount: slides.length } : {}), ...(p.cta ? { cta: p.cta } : {}) },
      createdBy: ctx.userId,
    });
    postIds.push(id);
  }
  await step("posts", { postIds });
  for (const id of postIds) await generateForPost(db, deps, ctx, id).catch((e) => warn("POST", e));

  // 5. Their images (brand design + image model), one post after another.
  await step("images");
  if (design && deps.images) {
    const written = await db.select({ id: posts.id }).from(posts).where(and(eq(posts.orgId, ctx.orgId), inArray(posts.id, postIds), sql`${posts.content} is not null`));
    for (const { id } of written) {
      try {
        const q = inline<PostImageJob>();
        await requestImages(db, q.queue, ctx, id, "new");
        for (const j of q.jobs) {
          const r = await runImageJob(db, deps, j);
          if (r === "failed") {
            const [row] = await db.select({ error: posts.mediaError }).from(posts).where(eq(posts.id, id));
            warnings.push(`IMAGES:${row?.error ?? "FAILED"}`);
          }
        }
      } catch (e) {
        warn("IMAGES", e);
      }
    }
  } else if (design) warnings.push("IMAGES:NOT_CONFIGURED");

  // 6. One ad set for Meta: copy now, creatives when there is a design.
  await step("ad");
  try {
    const meta = (await adNetworkInfo(db, ["meta"]))[0];
    const placements = (meta?.placements ?? []).slice(0, 2).map((p) => p.key);
    const adSetId = await createAdSet(db, deps, ctx, {
      brandId, objective: plan.ad.objective, networks: ["meta"], placements, offer: plan.ad.offer, landingUrl: d.url, brief: plan.ad.brief, language: plan.language,
    });
    await step("ad", { adSetId });
    const ad = await getAdSet(db, ctx, adSetId);
    if (ad.error) warnings.push(`AD:${ad.error.split(":")[0]}`);
    else if (design && deps.images) {
      const q = inline<AdImageJob>();
      await requestAdImages(db, q.queue, ctx, adSetId, "new");
      for (const j of q.jobs) {
        if ((await runAdImageJob(db, deps, j)) === "failed") {
          const [row] = await db.select({ error: adSets.mediaError }).from(adSets).where(eq(adSets.id, adSetId));
          warnings.push(`AD_IMAGES:${row?.error ?? "FAILED"}`);
        }
      }
    }
  } catch (e) {
    warn("AD", e);
  }

  await db.update(demos).set({ status: "ready", step: "done", error: null, warnings, updatedAt: new Date() }).where(eq(demos.id, d.id));
  return "ready";
}

// ---- The public, read-only view (no account: the token is the key) ------------------------------------------------

type Demo = typeof demos.$inferSelect;

/** The demo for `token` while its link works, else GONE (unknown, revoked and expired look the same). */
export async function demoByToken(db: Db, token: string, now = new Date()): Promise<Demo> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new DemoError("GONE");
  const [d] = await db.select().from(demos).where(eq(demos.tokenHash, hash(token)));
  if (!d || d.revokedAt || !d.expiresAt || d.expiresAt <= now) throw new DemoError("GONE");
  return d;
}

/** What the prospect sees: the brand, its logo, the posts with their current images, the ad copy and creatives. */
export async function demoView(db: Db, token: string, now = new Date()) {
  const d = await demoByToken(db, token, now);
  await db.update(demos).set({ lastViewedAt: now }).where(eq(demos.id, d.id));
  const base = { status: d.status, url: d.url, expiresAt: d.expiresAt!, brandName: null as string | null, logoId: null as string | null };
  if (d.status !== "ready" || !d.brandId) return { ...base, posts: [], ad: null };
  const [b] = await db.select({ name: brands.name }).from(brands).where(and(eq(brands.id, d.brandId), eq(brands.orgId, d.orgId)));
  const [logo] = await db.select({ id: brandAssets.id }).from(brandAssets).where(and(eq(brandAssets.orgId, d.orgId), eq(brandAssets.brandId, d.brandId), eq(brandAssets.kind, "logo"))).limit(1);
  const rows = d.postIds.length
    ? await db.select({ id: posts.id, format: posts.format, scheduledOn: posts.scheduledOn, content: posts.content, plan: posts.plan }).from(posts)
      .where(and(eq(posts.orgId, d.orgId), eq(posts.brandId, d.brandId), inArray(posts.id, d.postIds)))
    : [];
  const media = d.postIds.length
    ? await db.select({ id: postMedia.id, postId: postMedia.postId, position: postMedia.position, width: postMedia.width, height: postMedia.height }).from(postMedia)
      .where(and(eq(postMedia.orgId, d.orgId), inArray(postMedia.postId, d.postIds), eq(postMedia.kind, "slide"), isNull(postMedia.archivedAt))).orderBy(postMedia.position)
    : [];
  const order = new Map(d.postIds.map((id, i) => [id, i]));
  const postsOut = rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!).map((p) => ({
    id: p.id, format: p.format, scheduledOn: p.scheduledOn, topic: p.plan?.topic ?? null, content: p.content, images: media.filter((m) => m.postId === p.id),
  }));
  let ad = null;
  if (d.adSetId) {
    const [a] = await db.select({ name: adSets.name, copy: adSets.copy, offer: adSets.offer }).from(adSets).where(and(eq(adSets.id, d.adSetId), eq(adSets.orgId, d.orgId)));
    const creatives = await db.select({ id: adMedia.id, variant: adMedia.variant, placement: adMedia.placement, width: adMedia.width, height: adMedia.height }).from(adMedia)
      .where(and(eq(adMedia.orgId, d.orgId), eq(adMedia.adSetId, d.adSetId), eq(adMedia.kind, "creative"), isNull(adMedia.archivedAt))).orderBy(adMedia.variant, adMedia.placement);
    if (a) ad = { name: a.name, offer: a.offer, variants: a.copy.map((v) => v.meta ?? {}), creatives };
  }
  return { ...base, brandName: b?.name ?? null, logoId: logo?.id ?? null, posts: postsOut, ad };
}

/** A picture the demo shows (post image, ad creative or the brand logo): a short-lived URL, else NOT_FOUND. */
export async function demoMediaUrl(db: Db, storage: Storage, token: string, id: string, now = new Date()) {
  const d = await demoByToken(db, token, now);
  if (d.status !== "ready" || !d.brandId) throw new DemoError("NOT_FOUND");
  const inline = (key: string, type: string) => storage.presignGet(key, { filename: `slika.${type === "image/png" ? "png" : "jpg"}`, contentType: type, inline: true });
  if (d.postIds.length) {
    const [m] = await db.select({ key: postMedia.storageKey, type: postMedia.contentType }).from(postMedia)
      .where(and(eq(postMedia.orgId, d.orgId), eq(postMedia.id, id), inArray(postMedia.postId, d.postIds), eq(postMedia.kind, "slide"), isNull(postMedia.archivedAt)));
    if (m) return inline(m.key, m.type);
  }
  if (d.adSetId) {
    const [m] = await db.select({ key: adMedia.storageKey, type: adMedia.contentType }).from(adMedia)
      .where(and(eq(adMedia.orgId, d.orgId), eq(adMedia.id, id), eq(adMedia.adSetId, d.adSetId), eq(adMedia.kind, "creative"), isNull(adMedia.archivedAt)));
    if (m) return inline(m.key, m.type);
  }
  const [logo] = await db.select({ key: brandAssets.storageKey, type: brandAssets.contentType }).from(brandAssets)
    .where(and(eq(brandAssets.orgId, d.orgId), eq(brandAssets.id, id), eq(brandAssets.brandId, d.brandId), eq(brandAssets.kind, "logo")));
  if (logo) return inline(logo.key, logo.type);
  throw new DemoError("NOT_FOUND");
}
