// Credits (TASK-038, ADR-071): each paid action costs its listed credits (fix rounds and helper calls cost what
// "assist" costs); the month's allowance is used first, then packs soonest-expiring first; a failed call gives pack
// credits back; without an allowance nothing is limited; the € cap stays underneath; owners ask for packs and super
// admins grant them; prices are edited by super admins only and audited.
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { auditLog, creditPacks, creditRequests, orgSettings, usageLedger } from "../db/schema";
import { cappedCall } from "../llm/call";
import { createFakeLlm } from "../llm/fake";
import { CreditLimitError, release, reserve, SpendCapError } from "../llm/spend";
import { createOrganization, inviteMember } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { creditStatus, CreditError, grantCredits, listCreditPrices, orgCreditRequests, pendingCreditRequests, requestCredits, resolveCreditRequest, setCreditPrices } from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const NOW = new Date("2026-10-08T10:00:00Z");

let boss: { userId: string; role: "superadmin" }, A: OrgContext, editorA: OrgContext, orgA: string;
beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, usage_ledger, credit_packs, credit_requests cascade`;
  // "truncate user cascade" empties credit_prices too (updated_by → user): seed the defaults again, as migration 0043 does.
  await sql`insert into credit_prices (action, credits) values ('text',1),('illustration',2),('animation',1),('persona_image',5),('persona_video_5s',25),('persona_video_10s',40),('research',5),('assist',0)`;
  const s = (await session((await signIn("boss@datavallis.com"))!))!;
  boss = { userId: s.user.id, role: "superadmin" };
  const d = { mailer, baseURL: "http://localhost:3000" };
  orgA = (await createOrganization(db, d, boss, { name: "Org A", slug: "org-a", plan: "starter", ownerEmail: "boss@datavallis.com" })).orgId;
  await inviteMember(db, d, boss, orgA, { email: "ed@a.si", role: "editor" });
  const ed = (await session((await signIn("ed@a.si"))!))!.user;
  A = { userId: s.user.id, orgId: orgA, orgName: "Org A", role: "owner", plan: "starter" };
  editorA = { ...A, userId: ed.id, role: "editor" };
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

const allowance = (n: number | undefined) => db.update(orgSettings).set({ limits: n === undefined ? {} : { creditsPerMonth: n } }).where(eq(orgSettings.orgId, orgA));
const spend = (action: "text" | "illustration" | "persona_video_10s" | "assist", now = NOW) =>
  reserve(db, { orgId: orgA, brandId: null, postId: null, provider: "x", model: "m", estimate: 1000n, action, now });
const packs = async () => (await db.select().from(creditPacks).where(eq(creditPacks.orgId, orgA))).map((p) => [p.note, p.remaining]).sort();

describe("spending credits", () => {
  it("prices per action; the allowance first, then packs soonest-expiring first; a failed call refunds the packs", async () => {
    await allowance(5);
    await grantCredits(db, boss, orgA, { credits: 10, months: 12, note: "later" }, { now: NOW });
    await grantCredits(db, boss, orgA, { credits: 4, months: 1, note: "sooner" }, { now: NOW });
    await spend("text"); await spend("illustration"); await spend("assist"); // 3 of the allowance; assist is free
    expect(await creditStatus(db, orgA, NOW)).toMatchObject({ allowance: 5, usedThisMonth: 3, monthlyLeft: 2, packsLeft: 14, available: 16, level: "ok" });
    const id = await spend("illustration"); await spend("illustration"); // 2 from the month, then 2 from "sooner"
    expect(await packs()).toEqual([["later", 10], ["sooner", 2]]);
    const big = await spend("persona_video_10s").catch((e) => e); // 40 > 12 left
    expect(big).toBeInstanceOf(CreditLimitError);
    expect(big).toBeInstanceOf(SpendCapError);
    expect(big).toMatchObject({ needed: 40, available: 12 });
    const v = await spend("illustration"); // 2 from "sooner" (0 left)
    const w = await spend("illustration"); // 2 from "later"
    expect(await packs()).toEqual([["later", 8], ["sooner", 0]]);
    await release(db, v); await release(db, w);
    expect(await packs()).toEqual([["later", 10], ["sooner", 2]]);
    await release(db, id); // a call from the allowance: nothing to give back to packs
    expect(await packs()).toEqual([["later", 10], ["sooner", 2]]);
    const st = await creditStatus(db, orgA, NOW);
    expect(st).toMatchObject({ usedThisMonth: 5, monthlyLeft: 2, packsLeft: 12, available: 14 }); // the released call gave its 2 back to the month
    expect(st.packs.map((p) => p.remaining)).toEqual([2, 10]);
  });

  it("expired packs do not count; a new month brings the allowance back; 80 % warns; no allowance = not limited", async () => {
    await allowance(10);
    await grantCredits(db, boss, orgA, { credits: 50, months: 1 }, { now: new Date("2026-08-01T00:00:00Z") }); // expired
    for (let i = 0; i < 4; i++) await spend("illustration");
    expect((await creditStatus(db, orgA, NOW)).level).toBe("warn");
    await spend("illustration");
    expect(await creditStatus(db, orgA, NOW)).toMatchObject({ available: 0, level: "out" });
    await expect(spend("text")).rejects.toBeInstanceOf(CreditLimitError);
    const nov = new Date("2026-11-02T10:00:00Z");
    expect(await creditStatus(db, orgA, nov)).toMatchObject({ usedThisMonth: 0, available: 10, level: "ok" });
    await allowance(undefined);
    await spend("persona_video_10s");
    expect(await creditStatus(db, orgA, NOW)).toMatchObject({ allowance: null, available: null, level: "ok", usedThisMonth: 50 });
    const rows = await db.select().from(usageLedger).where(eq(usageLedger.orgId, orgA));
    expect(rows.filter((r) => r.action === "persona_video_10s").map((r) => r.credits)).toEqual([40]);
  });

  it("Claude calls: the first try costs the action, a fix round only 'assist'; the € cap still applies", async () => {
    await allowance(100);
    const llm = createFakeLlm([{ input: {} }, { input: {} }]);
    const req = { system: [{ text: "s" }], user: "u", tool: { name: "t", description: "d", inputSchema: {} }, maxTokens: 100 };
    await cappedCall(db, llm.client, { orgId: orgA, brandId: null, postId: null, now: NOW, action: "research" }, req);
    await cappedCall(db, llm.client, { orgId: orgA, brandId: null, postId: null, now: NOW }, req);
    expect((await db.select().from(usageLedger)).map((r) => [r.action, r.credits]).sort()).toEqual([["assist", 0], ["research", 5]]);
    await db.update(orgSettings).set({ spendCapMicroUsd: 0n }).where(eq(orgSettings.orgId, orgA));
    const e = await spend("text").catch((x) => x);
    expect(e).toBeInstanceOf(SpendCapError);
    expect(e).not.toBeInstanceOf(CreditLimitError);
  });
});

describe("prices and packs", () => {
  it("super admins edit prices (audited, only changes); owners ask for packs, super admins grant or decline once", async () => {
    expect((await listCreditPrices(db)).map((p) => [p.action, p.credits])).toEqual([
      ["text", 1], ["illustration", 2], ["animation", 1], ["persona_image", 5], ["persona_video_5s", 25], ["persona_video_10s", 40], ["research", 5], ["assist", 0],
    ]);
    await expect(setCreditPrices(db, { userId: A.userId, role: "user" }, { text: 2 })).rejects.toBeInstanceOf(CreditError);
    await expect(setCreditPrices(db, boss, { text: -1 })).rejects.toMatchObject({ code: "INVALID" });
    expect(await setCreditPrices(db, boss, { text: 2, illustration: 2 })).toEqual({ text: { from: 1, to: 2 } });
    await allowance(0);
    await grantCredits(db, boss, orgA, { credits: 3 }, { now: NOW });
    await spend("text");
    expect((await creditStatus(db, orgA, NOW)).packsLeft).toBe(1);

    await expect(requestCredits(db, editorA, "small")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requestCredits(db, A, "huge")).rejects.toMatchObject({ code: "INVALID" });
    const r1 = await requestCredits(db, A, "small");
    const r2 = await requestCredits(db, A, "large");
    await requestCredits(db, A, "small");
    await expect(requestCredits(db, A, "small")).rejects.toMatchObject({ code: "TOO_MANY" });
    expect((await pendingCreditRequests(db, boss)).map((r) => [r.orgName, r.pack, r.email])).toEqual([["Org A", "small", "boss@datavallis.com"], ["Org A", "large", "boss@datavallis.com"], ["Org A", "small", "boss@datavallis.com"]]);
    await expect(pendingCreditRequests(db, { userId: A.userId, role: "user" })).rejects.toBeInstanceOf(CreditError);
    await resolveCreditRequest(db, boss, r1, "grant", NOW);
    await expect(resolveCreditRequest(db, boss, r1, "grant", NOW)).rejects.toMatchObject({ code: "NOT_FOUND" }); // once
    await resolveCreditRequest(db, boss, r2, "decline", NOW);
    const p = (await db.select().from(creditPacks).where(eq(creditPacks.source, "purchase")))[0];
    expect(p).toMatchObject({ credits: 500, remaining: 500, note: "25 €" });
    expect(p.expiresAt.toISOString()).toBe("2027-10-08T10:00:00.000Z");
    expect((await db.select().from(creditRequests).where(eq(creditRequests.id, r1)))[0].packId).toBe(p.id);
    expect((await orgCreditRequests(db, A)).map((r) => r.status).sort()).toEqual(["declined", "granted", "pending"]);
    expect((await db.select().from(auditLog)).map((a) => a.action).filter((a) => a.startsWith("credits.")).sort())
      .toEqual(["credits.decline", "credits.grant", "credits.grant", "credits.prices", "credits.request", "credits.request", "credits.request"]);
  });
});
