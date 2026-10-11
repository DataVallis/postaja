// Self-serve signup and the trial (TASK-037, ADR-084): a signup request lets an unknown email get an account (only with
// PUBLIC_SIGNUP=1, rate-limited); confirming creates a trial organization (7 days, 1 brand, 1 member, 50 credits) with
// the person as owner; when the trial ends without a plan new AI work stops; owners get one email before it ends;
// first steps come from the organization's data.
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { canSignUp } from "../auth/auth";
import { createBrand, getBrandDetail, saveProfilePart } from "../brands/service";
import { auditLog, member, organization, orgBilling, orgSettings, planImports, posts } from "../db/schema";
import { BillingBlockedError, reserve } from "../llm/spend";
import { createCaptureMailer } from "../email/mailer";
import type { OrgContext } from "../tenancy/context";
import { firstSteps, hashIp, markDownload, pendingSignup, requestSignup, sendTrialNotices, SIGNUP_MAX_PER_EMAIL_DAY, startTrial } from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const NOW = new Date("2026-10-11T08:00:00Z");
const DAY = 86_400_000;
const deps = { superadminEmails: new Set<string>(), db };

beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  process.env.PUBLIC_SIGNUP = "1";
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, org_billing, signup_requests, usage_ledger, brands cascade`;
});
afterEach(() => { delete process.env.PUBLIC_SIGNUP; });
afterAll(async () => { await sql.end({ timeout: 5 }); });

/** Signs up like /signup + the magic link + /app/start; returns the owner's context. */
async function signUp(email: string, orgName: string, now = new Date()): Promise<OrgContext> {
  await requestSignup(db, { email, orgName, ipHash: "" }, now);
  const s = (await session((await signIn(email))!))!;
  const orgId = await startTrial(db, { userId: s.user.id, email: s.user.email }, undefined, now);
  return { userId: s.user.id, orgId, orgName, role: "owner", plan: "trial" };
}

describe("signup", () => {
  it("is off without PUBLIC_SIGNUP; a request lets an unknown email sign in; rate limits per email and IP", async () => {
    delete process.env.PUBLIC_SIGNUP;
    await expect(requestSignup(db, { email: "ana@pekarna.si", orgName: "Pekarna", ipHash: "" })).rejects.toMatchObject({ code: "DISABLED" });
    process.env.PUBLIC_SIGNUP = "1";
    expect(await canSignUp("ana@pekarna.si", deps)).toBe(false);
    expect(await signIn("ana@pekarna.si")).toBeNull(); // no request → no mail, no account
    await expect(requestSignup(db, { email: "ni-email", orgName: "Pekarna", ipHash: "" })).rejects.toMatchObject({ code: "INVALID" });
    await expect(requestSignup(db, { email: "ana@pekarna.si", orgName: "P", ipHash: "" })).rejects.toMatchObject({ code: "INVALID" });
    await requestSignup(db, { email: " Ana@Pekarna.si ", orgName: "Pekarna Ana", ipHash: "" });
    expect(await canSignUp("ana@pekarna.si", deps)).toBe(true);
    expect((await pendingSignup(db, "ANA@pekarna.si"))?.orgName).toBe("Pekarna Ana");
    delete process.env.PUBLIC_SIGNUP;
    expect(await canSignUp("ana@pekarna.si", deps)).toBe(false); // switched off → requests no longer count
    process.env.PUBLIC_SIGNUP = "1";
    expect(await pendingSignup(db, "ana@pekarna.si", new Date(Date.now() + 2 * DAY))).toBeNull(); // a day at most
    for (let i = 1; i < SIGNUP_MAX_PER_EMAIL_DAY; i++) await requestSignup(db, { email: "ana@pekarna.si", orgName: "Pekarna", ipHash: "" });
    await expect(requestSignup(db, { email: "ana@pekarna.si", orgName: "Pekarna", ipHash: "" })).rejects.toMatchObject({ code: "TOO_MANY" });
    const ip = hashIp("203.0.113.9", "s");
    expect(ip).toHaveLength(32);
    expect(ip).not.toContain("203");
    for (let i = 0; i < 10; i++) await requestSignup(db, { email: `x${i}@ex.si`, orgName: "Spam", ipHash: ip });
    await expect(requestSignup(db, { email: "y@ex.si", orgName: "Spam", ipHash: ip })).rejects.toMatchObject({ code: "TOO_MANY" });
  });

  it("confirming creates a trial organization with the person as owner; once; a taken slug gets a suffix", async () => {
    const A = await signUp("ana@pekarna.si", "Pekarna Ana", NOW);
    const [o] = await db.select().from(organization).where(eq(organization.id, A.orgId));
    expect(o).toMatchObject({ name: "Pekarna Ana", slug: "pekarna-ana" });
    expect((await db.select().from(orgSettings).where(eq(orgSettings.orgId, A.orgId)))[0]).toMatchObject({ plan: "trial", limits: { brands: 1, members: 1, creditsPerMonth: 50 } });
    expect((await db.select().from(member).where(eq(member.organizationId, A.orgId)))[0]).toMatchObject({ userId: A.userId, role: "owner" });
    expect((await db.select().from(orgBilling).where(eq(orgBilling.orgId, A.orgId)))[0].trialEndsAt!.toISOString()).toBe("2026-10-18T08:00:00.000Z");
    expect((await db.select().from(auditLog).where(eq(auditLog.orgId, A.orgId))).map((r) => r.action)).toEqual(["org.signup"]);
    // The request is used: no second organization, and signing up again while a member is refused.
    await expect(startTrial(db, { userId: A.userId, email: "ana@pekarna.si" })).rejects.toMatchObject({ code: "NO_REQUEST" });
    await requestSignup(db, { email: "ana@pekarna.si", orgName: "Druga", ipHash: "" });
    await expect(startTrial(db, { userId: A.userId, email: "ana@pekarna.si" })).rejects.toMatchObject({ code: "HAS_ORG" });
    const B = await signUp("bor@pekarna.si", "Pekarna Ana");
    expect((await db.select().from(organization).where(eq(organization.id, B.orgId)))[0].slug).toMatch(/^pekarna-ana-[a-z0-9]{4}$/);
  });

  it("AI work runs during the trial (50 credits a month) and stops when it ends without a plan; a plan resumes it", async () => {
    const A = await signUp("ana@pekarna.si", "Pekarna", NOW);
    const spend = (now: Date) => reserve(db, { orgId: A.orgId, brandId: null, postId: null, provider: "x", model: "m", estimate: 1n, action: "assist", now });
    await expect(spend(new Date(NOW.getTime() + 6 * DAY))).resolves.toBeTypeOf("string");
    await expect(spend(new Date(NOW.getTime() + 8 * DAY))).rejects.toBeInstanceOf(BillingBlockedError);
    await db.update(orgBilling).set({ status: "active", stripeSubscriptionId: "sub_1" }).where(eq(orgBilling.orgId, A.orgId));
    await expect(spend(new Date(NOW.getTime() + 8 * DAY))).resolves.toBeTypeOf("string");
  });
});

describe("first steps", () => {
  it("shown to self-serve organizations until a brand, a CGP, a plan import, a post and a download exist", async () => {
    const A = await signUp("ana@pekarna.si", "Pekarna", NOW);
    let f = await firstSteps(db, A.orgId);
    expect(f).toMatchObject({ show: true, firstBrandId: null, done: { brand: false, cgp: false, plan: false, post: false, download: false } });
    const brand = (await createBrand(db, A, { name: "Pekarna", slug: "pekarna", languages: ["sl"] })).id;
    await saveProfilePart(db, A, brand, { cgp: "Topel ton." });
    await db.insert(planImports).values({ id: crypto.randomUUID(), orgId: A.orgId, filename: "plan.xlsx", storageKey: "k", sha256: "x", kind: "table", status: "draft", reader: { by: "ai" }, createdBy: A.userId });
    expect((await firstSteps(db, A.orgId)).done.plan).toBe(false); // read, not imported yet
    await db.update(planImports).set({ status: "imported" });
    const { profile } = await getBrandDetail(db, A, brand);
    await db.insert(posts).values({ id: crypto.randomUUID(), orgId: A.orgId, brandId: brand, profileVersionId: profile!.id, brief: "Kruh", content: { caption: "Svež kruh" }, createdBy: A.userId } as never);
    f = await firstSteps(db, A.orgId);
    expect(f).toMatchObject({ show: true, firstBrandId: brand, done: { brand: true, cgp: true, plan: true, post: true, download: false } });
    await markDownload(db, A.orgId, NOW);
    await markDownload(db, A.orgId, new Date(NOW.getTime() + DAY));
    expect((await db.select().from(orgSettings).where(eq(orgSettings.orgId, A.orgId)))[0].firstDownloadAt!.toISOString()).toBe(NOW.toISOString());
    expect((await firstSteps(db, A.orgId)).show).toBe(false);
  });
});

describe("trial ending notice", () => {
  it("owners of trials ending within 48 hours without a plan get one email", async () => {
    const A = await signUp("ana@pekarna.si", "Pekarna Ana", NOW);
    const B = await signUp("bor@kava.si", "Kava Bor", NOW);
    await db.update(orgBilling).set({ status: "active" }).where(eq(orgBilling.orgId, B.orgId)); // bought a plan
    const out = createCaptureMailer();
    expect(await sendTrialNotices(db, out, "https://p.si", new Date(NOW.getTime() + 4 * DAY))).toBe(0); // 3 days left
    expect(await sendTrialNotices(db, out, "https://p.si/", new Date(NOW.getTime() + 5.5 * DAY), () => "18. oktober 2026")).toBe(1);
    expect(out.sent.map((m) => [m.to, m.subject])).toEqual([["ana@pekarna.si", "Preizkus Postaje se izteka"]]);
    expect(out.sent[0].text).toContain("Preizkus Postaje za Pekarna Ana se konča 18. oktober 2026");
    expect(out.sent[0].text).toContain("https://p.si/app/team#billing-h");
    expect(await sendTrialNotices(db, out, "https://p.si", new Date(NOW.getTime() + 6 * DAY))).toBe(0); // once
    void A;
  });
});
