import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { auditLog, invitation, member } from "../db/schema";
import { createOrganization, ForbiddenError, inviteMember, updateOrgSettings } from "../orgs/service";
import { getOrganizationDetail, listAudit, listOrganizations } from "./queries";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const deps = { mailer, baseURL: "http://localhost:3000" };
const nobody = { userId: "nobody", role: "user" as const };

beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log cascade`;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

async function boss() {
  const s = (await session((await signIn("boss@datavallis.com"))!))!;
  return { userId: s.user.id, role: "superadmin" as const };
}
const auditCount = async () => (await sql`select count(*)::int n from audit_log`)[0].n as number;

describe("audit log", () => {
  it("createOrganization writes exactly one audit row with actor, org and bigint-safe meta", async () => {
    const actor = await boss();
    const { orgId } = await createOrganization(db, deps, actor, { name: "Data Vallis", slug: "data-vallis", plan: "comped", ownerEmail: "boss@datavallis.com", spendCapMicroUsd: 0n });
    const rows = await db.select().from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: actor.userId, orgId, action: "org.create", target: "data-vallis" });
    expect(rows[0].meta).toMatchObject({ plan: "comped", ownerStatus: "member", spendCapMicroUsd: "0" });
  });

  it("updateOrgSettings audits from → to for each changed field", async () => {
    const actor = await boss();
    const { orgId } = await createOrganization(db, deps, actor, { name: "Acme", slug: "acme", plan: "trial", ownerEmail: "o@acme.si" });
    await updateOrgSettings(db, actor, orgId, { plan: "pro", spendCapMicroUsd: 12_500_000n });
    const [row] = await db.select().from(auditLog).where(eq(auditLog.action, "org.settings.update"));
    expect(row.meta).toEqual({ plan: { from: "trial", to: "pro" }, spendCapMicroUsd: { from: "50000000", to: "12500000" } });
  });

  it("refused actions write nothing — no change, no audit row", async () => {
    const actor = await boss();
    const { orgId } = await createOrganization(db, deps, actor, { name: "Acme", slug: "acme", plan: "trial", ownerEmail: "o@acme.si" });
    const before = await auditCount();
    await expect(updateOrgSettings(db, nobody, orgId, { plan: "comped" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inviteMember(db, deps, nobody, orgId, { email: "x@y.si", role: "owner" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await auditCount()).toBe(before);
    expect((await sql`select plan from org_settings`)[0].plan).toBe("trial");
  });

  it("a failed change rolls back its audit row (unknown org)", async () => {
    const actor = await boss();
    const before = await auditCount();
    await expect(updateOrgSettings(db, actor, "does-not-exist", { plan: "pro" })).rejects.toThrow("ORG_NOT_FOUND");
    await expect(inviteMember(db, deps, actor, "does-not-exist", { email: "x@y.si", role: "editor" })).rejects.toThrow("ORG_NOT_FOUND");
    expect(await auditCount()).toBe(before);
  });
});

describe("inviteMember", () => {
  it("existing user → member now; again with another role → role updated, still one membership", async () => {
    const actor = await boss();
    const { orgId } = await createOrganization(db, deps, actor, { name: "Acme", slug: "acme", plan: "pro", ownerEmail: "o@acme.si" });
    expect((await inviteMember(db, deps, actor, orgId, { email: "Boss@DataVallis.com", role: "editor" })).status).toBe("member");
    await inviteMember(db, deps, actor, orgId, { email: "boss@datavallis.com", role: "owner" });
    const rows = await db.select().from(member).where(eq(member.organizationId, orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("owner");
  });

  it("new email → invitation + mail; re-invite cancels the previous pending one", async () => {
    const actor = await boss();
    const { orgId } = await createOrganization(db, deps, actor, { name: "Acme", slug: "acme", plan: "pro", ownerEmail: "o@acme.si" });
    mailer.sent.length = 0;
    await inviteMember(db, deps, actor, orgId, { email: "ed@acme.si", role: "editor" });
    await inviteMember(db, deps, actor, orgId, { email: "ED@acme.si", role: "owner" });
    const inv = await db.select().from(invitation).where(eq(invitation.email, "ed@acme.si"));
    expect(inv.map((i) => i.status).sort()).toEqual(["canceled", "pending"]);
    expect(inv.find((i) => i.status === "pending")!.role).toBe("owner");
    expect(mailer.sent.map((m) => m.to)).toEqual(["ed@acme.si", "ed@acme.si"]);
  });

  it("invalid email or role is rejected", async () => {
    const actor = await boss();
    const { orgId } = await createOrganization(db, deps, actor, { name: "Acme", slug: "acme", plan: "pro", ownerEmail: "o@acme.si" });
    await expect(inviteMember(db, deps, actor, orgId, { email: "nope", role: "editor" })).rejects.toThrow();
    await expect(inviteMember(db, deps, actor, orgId, { email: "a@b.si", role: "admin" as never })).rejects.toThrow();
  });
});

describe("admin queries", () => {
  it("list shows plan, status, member and pending counts; detail lists members and invites; audit newest first", async () => {
    const actor = await boss();
    const dv = await createOrganization(db, deps, actor, { name: "Data Vallis", slug: "data-vallis", plan: "comped", ownerEmail: "boss@datavallis.com" });
    const acme = await createOrganization(db, deps, actor, { name: "Acme", slug: "acme", plan: "trial", ownerEmail: "o@acme.si" });
    const list = await listOrganizations(db);
    expect(list.map((o) => [o.slug, o.plan, o.members, o.pendingInvites])).toEqual([
      ["data-vallis", "comped", 1, 0],
      ["acme", "trial", 0, 1],
    ]);
    const detail = (await getOrganizationDetail(db, acme.orgId))!;
    expect(detail.members).toEqual([]);
    expect(detail.invites.map((i) => i.email)).toEqual(["o@acme.si"]);
    expect((await getOrganizationDetail(db, dv.orgId))!.members.map((m) => m.email)).toEqual(["boss@datavallis.com"]);
    expect(await getOrganizationDetail(db, "missing")).toBeNull();
    const audit = await listAudit(db);
    expect(audit.map((a) => a.target)).toEqual(["acme", "data-vallis"]);
    expect(audit[0].actor).toBe("boss@datavallis.com");
  });
});
