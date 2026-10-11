// Self-serve signup and the free trial (TASK-037, ADR-084). Public signup is on only where PUBLIC_SIGNUP=1.
// 1) /signup stores a request (email + organization name) and sends the normal magic link — the request is what lets an
//    unknown email get an account (canSignUp); rate-limited per email and per IP (hashed, never stored raw);
// 2) the link signs the person in and lands on /app/start, where they confirm and the trial organization is created:
//    plan `trial`, 7 days, 1 brand, 1 member, 50 credits, Studio's features, no card. When the trial ends (and no plan
//    was bought) new AI work stops like an ended pilot; everything made stays.
import { createHash } from "node:crypto";
import { and, desc, eq, gt, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { slugify } from "@/lib/slug";
import { normalizeEmail } from "../auth/emails";
import { TRIAL } from "../billing/catalog";
import type { Db } from "../db/client";
import { auditLog, brandProfileVersions, brands, member, organization, orgBilling, orgSettings, planImports, posts, signupRequests, user } from "../db/schema";
import type { Mailer } from "../email/mailer";
import { trialEndingMail } from "../email/templates/trial-ending";

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** A signup request lets its email get an account for this long (the magic link itself lives 10 minutes). */
export const SIGNUP_REQUEST_TTL_MS = DAY;
export const SIGNUP_MAX_PER_EMAIL_DAY = 3;
export const SIGNUP_MAX_PER_IP_HOUR = 10;

export class SignupError extends Error {
  constructor(public readonly code: "DISABLED" | "INVALID" | "TOO_MANY" | "HAS_ORG" | "NO_REQUEST") {
    super(code);
  }
}

export const publicSignupEnabled = () => process.env.PUBLIC_SIGNUP === "1";

/** The IP as a keyed hash: enough to count requests, useless to identify anyone. */
export const hashIp = (ip: string, secret: string) => (ip ? createHash("sha256").update(`${secret}:${ip}`).digest("hex").slice(0, 32) : "");

const requestInput = z.object({
  email: z.email().transform(normalizeEmail),
  orgName: z.string().trim().min(2).max(80),
});

/** Step 1: a request for a trial. The caller then sends the magic link (same answer whatever the email). */
export async function requestSignup(db: Db, input: { email: string; orgName: string; ipHash: string }, now = new Date()): Promise<{ email: string }> {
  if (!publicSignupEnabled()) throw new SignupError("DISABLED");
  const data = requestInput.safeParse({ email: input.email.trim(), orgName: input.orgName });
  if (!data.success) throw new SignupError("INVALID");
  const { email, orgName } = data.data;
  const [byEmail] = await db.select({ n: sql<number>`count(*)::int` }).from(signupRequests)
    .where(and(eq(signupRequests.email, email), gt(signupRequests.createdAt, new Date(now.getTime() - DAY))));
  if (byEmail.n >= SIGNUP_MAX_PER_EMAIL_DAY) throw new SignupError("TOO_MANY");
  if (input.ipHash) {
    const [byIp] = await db.select({ n: sql<number>`count(*)::int` }).from(signupRequests)
      .where(and(eq(signupRequests.ipHash, input.ipHash), gt(signupRequests.createdAt, new Date(now.getTime() - HOUR))));
    if (byIp.n >= SIGNUP_MAX_PER_IP_HOUR) throw new SignupError("TOO_MANY");
  }
  await db.insert(signupRequests).values({ id: crypto.randomUUID(), email, orgName, ipHash: input.ipHash, createdAt: now });
  return { email };
}

/** The newest unused, unexpired request for this email (for canSignUp and /app/start). */
export async function pendingSignup(db: Db, email: string, now = new Date()) {
  if (!publicSignupEnabled()) return null;
  const [r] = await db.select().from(signupRequests)
    .where(and(eq(signupRequests.email, normalizeEmail(email)), isNull(signupRequests.usedAt), gt(signupRequests.createdAt, new Date(now.getTime() - SIGNUP_REQUEST_TTL_MS))))
    .orderBy(desc(signupRequests.createdAt)).limit(1);
  return r ?? null;
}

async function freeSlug(db: Db, name: string): Promise<string> {
  const base = (slugify(name) || "organizacija").slice(0, 40).replace(/-+$/g, "");
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const [taken] = await db.select({ id: organization.id }).from(organization).where(eq(organization.slug, slug));
    if (!taken) return slug;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Step 2 (signed in, no organization yet): creates the trial organization from the pending request, with the person as
 * its owner. `orgName` may correct the name typed at signup.
 */
export async function startTrial(db: Db, who: { userId: string; email: string }, orgName?: string, now = new Date()): Promise<string> {
  const req = await pendingSignup(db, who.email, now);
  if (!req) throw new SignupError("NO_REQUEST");
  const [has] = await db.select({ id: member.id }).from(member).where(eq(member.userId, who.userId)).limit(1);
  if (has) throw new SignupError("HAS_ORG");
  const name = (orgName ?? req.orgName).trim();
  if (name.length < 2 || name.length > 80) throw new SignupError("INVALID");
  const orgId = crypto.randomUUID();
  const slug = await freeSlug(db, name);
  const trialEndsAt = new Date(now.getTime() + TRIAL.days * DAY);
  await db.transaction(async (tx) => {
    // Once per request, even when two tabs confirm at the same time.
    const used = await tx.update(signupRequests).set({ usedAt: now }).where(and(eq(signupRequests.id, req.id), isNull(signupRequests.usedAt))).returning({ id: signupRequests.id });
    if (!used.length) throw new SignupError("NO_REQUEST");
    await tx.insert(organization).values({ id: orgId, name, slug });
    await tx.insert(orgSettings).values({ orgId, plan: "trial", limits: { ...TRIAL.limits } });
    await tx.insert(member).values({ id: crypto.randomUUID(), organizationId: orgId, userId: who.userId, role: "owner" });
    await tx.insert(orgBilling).values({ orgId, trialEndsAt });
    await tx.insert(auditLog).values({ id: crypto.randomUUID(), actorUserId: who.userId, orgId, action: "org.signup", target: slug, meta: { name, trialEndsAt: trialEndsAt.toISOString() } });
  });
  return orgId;
}

// ---- First steps (dashboard checklist) --------------------------------------------------------------------------

export const FIRST_STEPS = ["brand", "cgp", "plan", "post", "download"] as const;
export type FirstStep = (typeof FIRST_STEPS)[number];

/**
 * What a new organization has done of its first steps — computed from its data: a brand, a CGP (any saved text), an
 * imported plan, a post with text, a download. `show` only for self-serve organizations (they have a trial date) until
 * every step is done.
 */
export async function firstSteps(db: Db, orgId: string): Promise<{ done: Record<FirstStep, boolean>; firstBrandId: string | null; show: boolean }> {
  const one = async (q: Promise<{ id: string }[]>) => (await q)[0]?.id ?? null;
  const [brand, cgp, plan, post, s, b] = await Promise.all([
    one(db.select({ id: brands.id }).from(brands).where(and(eq(brands.orgId, orgId), isNull(brands.archivedAt))).orderBy(brands.createdAt).limit(1)),
    one(db.select({ id: brandProfileVersions.id }).from(brandProfileVersions).where(and(eq(brandProfileVersions.orgId, orgId), sql`length(trim(${brandProfileVersions.cgp})) > 0`)).limit(1)),
    one(db.select({ id: planImports.id }).from(planImports).where(and(eq(planImports.orgId, orgId), eq(planImports.status, "imported"))).limit(1)),
    one(db.select({ id: posts.id }).from(posts).where(and(eq(posts.orgId, orgId), isNotNull(posts.content))).limit(1)),
    db.select({ at: orgSettings.firstDownloadAt }).from(orgSettings).where(eq(orgSettings.orgId, orgId)),
    db.select({ trial: orgBilling.trialEndsAt }).from(orgBilling).where(eq(orgBilling.orgId, orgId)),
  ]);
  const done = { brand: !!brand, cgp: !!cgp, plan: !!plan, post: !!post, download: !!s[0]?.at };
  return { done, firstBrandId: brand, show: !!b[0]?.trial && !Object.values(done).every(Boolean) };
}

/** Called by the download routes: remembers the organization's first download (once). */
export async function markDownload(db: Db, orgId: string, now = new Date()): Promise<void> {
  await db.update(orgSettings).set({ firstDownloadAt: now }).where(and(eq(orgSettings.orgId, orgId), isNull(orgSettings.firstDownloadAt)));
}

// ---- Trial ending notice (daily job) ----------------------------------------------------------------------------

export const TRIAL_NOTICE_QUEUE = "trial-notice";

/**
 * Emails the owners of every trial that ends within the next 48 hours and has no plan yet — once per organization.
 * Returns how many organizations were notified.
 */
export async function sendTrialNotices(db: Db, mailer: Mailer, baseURL: string, now = new Date(), fmt: (d: Date) => string = (d) => d.toLocaleDateString("sl-SI", { timeZone: "Europe/Ljubljana", day: "numeric", month: "long", year: "numeric" })): Promise<number> {
  const due = await db.select({ orgId: orgBilling.orgId, endsAt: orgBilling.trialEndsAt, name: organization.name }).from(orgBilling)
    .innerJoin(organization, eq(organization.id, orgBilling.orgId))
    .where(and(isNotNull(orgBilling.trialEndsAt), gte(orgBilling.trialEndsAt, now), lte(orgBilling.trialEndsAt, new Date(now.getTime() + 2 * DAY)),
      isNull(orgBilling.trialNoticeAt), eq(orgBilling.status, "none")));
  let sent = 0;
  for (const o of due) {
    const claimed = await db.update(orgBilling).set({ trialNoticeAt: now }).where(and(eq(orgBilling.orgId, o.orgId), isNull(orgBilling.trialNoticeAt))).returning({ id: orgBilling.orgId });
    if (!claimed.length) continue;
    const owners = await db.select({ email: user.email }).from(member).innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, o.orgId), eq(member.role, "owner")));
    for (const w of owners) await mailer.send(trialEndingMail(w.email, o.name, fmt(o.endsAt!), `${baseURL.replace(/\/$/, "")}/app/team#billing-h`));
    sent++;
  }
  return sent;
}
