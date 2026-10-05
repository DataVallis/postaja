import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { crossTenantSuite } from "../../../tests/tenancy/harness";
import { invitation, member, organization, orgSettings, user } from "../db/schema";
import { resolveOrgContext, TenancyError } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { createOrganization, ForbiddenError, updateOrgSettings } from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const t = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const { db, mailer, auth, signIn, session, headers } = t;
const deps = { mailer, baseURL: "http://localhost:3000" };

beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings cascade`;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

async function superadmin() {
  const cookie = (await signIn("boss@datavallis.com"))!;
  const s = (await session(cookie))!;
  return { cookie, actor: { userId: s.user.id, role: "superadmin" as const } };
}

describe("createOrganization (super admin only)", () => {
  it("non-superadmin is refused and nothing is written", async () => {
    await expect(
      createOrganization(db, deps, { userId: "x", role: "user" }, { name: "Acme", slug: "acme", plan: "pro", ownerEmail: "o@acme.si" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await sql`select count(*)::int n from organization`)[0].n).toBe(0);
  });

  it("existing user becomes owner immediately; settings row created with plan", async () => {
    const { actor } = await superadmin();
    const r = await createOrganization(db, deps, actor, { name: "Data Vallis", slug: "data-vallis", plan: "comped", ownerEmail: "BOSS@datavallis.com" });
    expect(r.ownerStatus).toBe("member");
    const [m] = await db.select().from(member).where(eq(member.organizationId, r.orgId));
    expect(m.role).toBe("owner");
    const [s] = await db.select().from(orgSettings).where(eq(orgSettings.orgId, r.orgId));
    expect(s.plan).toBe("comped");
    expect(s.spendCapMicroUsd).toBe(50_000_000n);
  });

  it("unknown owner gets an invitation mail; duplicate slug is rejected", async () => {
    const { actor } = await superadmin();
    const r = await createOrganization(db, deps, actor, { name: "Acme", slug: "acme", plan: "trial", ownerEmail: "Owner@Acme.si" });
    expect(r.ownerStatus).toBe("invited");
    const invites = await db.select().from(invitation);
    expect(invites).toMatchObject([{ email: "owner@acme.si", role: "owner", status: "pending" }]);
    expect(mailer.sent.at(-1)!.to).toBe("owner@acme.si");
    await expect(createOrganization(db, deps, actor, { name: "Acme 2", slug: "acme", plan: "trial", ownerEmail: "x@y.si" })).rejects.toThrow();
  });

  it("invalid input is rejected (slug, plan, negative cap)", async () => {
    const { actor } = await superadmin();
    await expect(createOrganization(db, deps, actor, { name: "A", slug: "Bad Slug", plan: "pro", ownerEmail: "a@b.si" })).rejects.toThrow();
    await expect(createOrganization(db, deps, actor, { name: "Acme", slug: "acme", plan: "gold" as never, ownerEmail: "a@b.si" })).rejects.toThrow();
    await expect(createOrganization(db, deps, actor, { name: "Acme", slug: "acme", plan: "pro", ownerEmail: "a@b.si", spendCapMicroUsd: -1n })).rejects.toThrow();
  });
});

describe("invitations and sign-up", () => {
  it("invited email can sign up; on sign-in the invitation is accepted and the org becomes active", async () => {
    const { actor } = await superadmin();
    const { orgId } = await createOrganization(db, deps, actor, { name: "Acme", slug: "acme", plan: "pro", ownerEmail: "owner@acme.si" });
    const cookie = await signIn("Owner@Acme.si");
    expect(cookie).not.toBeNull();
    const s = (await session(cookie!))!;
    expect((s.session as { activeOrganizationId?: string }).activeOrganizationId).toBe(orgId);
    expect((s.user as { role?: string }).role).toBe("user");
    const [inv] = await db.select().from(invitation);
    expect(inv.status).toBe("accepted");
    const ctx = await resolveOrgContext(db, { userId: s.user.id, activeOrganizationId: orgId });
    expect(ctx).toMatchObject({ orgId, orgName: "Acme", role: "owner", plan: "pro" });
  });

  it("expired invitation does not allow sign-up (no mail, no user)", async () => {
    const { actor } = await superadmin();
    await createOrganization(db, deps, actor, { name: "Acme", slug: "acme", plan: "pro", ownerEmail: "late@acme.si" });
    await db.update(invitation).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await signIn("late@acme.si")).toBeNull();
    expect((await sql`select count(*)::int n from "user" where email = 'late@acme.si'`)[0].n).toBe(0);
  });

  it("canceled invitation does not allow sign-up", async () => {
    const { actor } = await superadmin();
    await createOrganization(db, deps, actor, { name: "Acme", slug: "acme", plan: "pro", ownerEmail: "gone@acme.si" });
    await db.update(invitation).set({ status: "canceled" });
    expect(await signIn("gone@acme.si")).toBeNull();
  });

  it("owner can invite an editor through Better Auth; the editor cannot invite anyone", async () => {
    const { actor } = await superadmin();
    const { orgId } = await createOrganization(db, deps, actor, { name: "Acme", slug: "acme", plan: "pro", ownerEmail: "owner@acme.si" });
    const ownerCookie = (await signIn("owner@acme.si"))!;
    await auth.api.createInvitation({ body: { email: "ed@acme.si", role: "editor", organizationId: orgId }, headers: headers({ cookie: ownerCookie }) });
    expect(mailer.sent.at(-1)!.to).toBe("ed@acme.si");
    const edCookie = (await signIn("ed@acme.si"))!;
    const edSession = (await session(edCookie))!;
    const ctx = await resolveOrgContext(db, { userId: edSession.user.id, activeOrganizationId: orgId });
    expect(ctx.role).toBe("editor");
    await expect(
      auth.api.createInvitation({ body: { email: "friend@x.si", role: "owner", organizationId: orgId }, headers: headers({ cookie: edCookie }) }),
    ).rejects.toThrow();
    expect((await sql`select count(*)::int n from invitation where email = 'friend@x.si'`)[0].n).toBe(0);
  });

  it("users cannot create organizations through the API", async () => {
    const { cookie } = await superadmin();
    await expect(auth.api.createOrganization({ body: { name: "Mine", slug: "mine" }, headers: headers({ cookie }) })).rejects.toThrow();
    expect((await sql`select count(*)::int n from organization`)[0].n).toBe(0);
  });
});

describe("resolveOrgContext", () => {
  it("rejects a forged active org: member of B pointing the session at A (A has real members)", async () => {
    const { actor } = await superadmin();
    const a = await createOrganization(db, deps, actor, { name: "Org A", slug: "org-a", plan: "pro", ownerEmail: "boss@datavallis.com" });
    await createOrganization(db, deps, actor, { name: "Org B", slug: "org-b", plan: "pro", ownerEmail: "b@b.si" });
    const bCookie = (await signIn("b@b.si"))!;
    const bUser = (await session(bCookie))!.user;
    expect((await sql`select count(*)::int n from member where organization_id = ${a.orgId}`)[0].n).toBe(1);
    await expect(resolveOrgContext(db, { userId: bUser.id, activeOrganizationId: a.orgId })).rejects.toMatchObject({ code: "NOT_A_MEMBER" });
    await expect(auth.api.setActiveOrganization({ body: { organizationId: a.orgId }, headers: headers({ cookie: bCookie }) })).rejects.toThrow();
  });

  it("rejects no active org and suspended orgs", async () => {
    const { actor } = await superadmin();
    await expect(resolveOrgContext(db, { userId: actor.userId, activeOrganizationId: null })).rejects.toBeInstanceOf(TenancyError);
    const { orgId } = await createOrganization(db, deps, actor, { name: "DV", slug: "dv", plan: "comped", ownerEmail: "boss@datavallis.com" });
    await updateOrgSettings(db, actor, orgId, { status: "suspended" });
    await expect(resolveOrgContext(db, { userId: actor.userId, activeOrganizationId: orgId })).rejects.toMatchObject({ code: "ORG_SUSPENDED" });
  });
  it("updateOrgSettings is super admin only and rejects unknown fields", async () => {
    const { actor } = await superadmin();
    const { orgId } = await createOrganization(db, deps, actor, { name: "DV", slug: "dv", plan: "trial", ownerEmail: "boss@datavallis.com" });
    await expect(updateOrgSettings(db, { userId: "x", role: "user" }, orgId, { plan: "comped" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateOrgSettings(db, actor, orgId, { orgId: "other" } as never)).rejects.toThrow();
    expect((await updateOrgSettings(db, actor, orgId, { plan: "comped", spendCapMicroUsd: 0n })).plan).toBe("comped");
  });
});

describe("forOrg cross-tenant isolation", () => {
  let orgA = "";
  let orgB = "";
  beforeEach(async () => {
    const { actor } = await superadmin();
    orgA = (await createOrganization(db, deps, actor, { name: "Org A", slug: "org-a", plan: "pro", ownerEmail: "a@a.si" })).orgId;
    orgB = (await createOrganization(db, deps, actor, { name: "Org B", slug: "org-b", plan: "pro", ownerEmail: "b@b.si" })).orgId;
  });
  const scopes = () => ({ a: forOrg(db, { orgId: orgA }), b: forOrg(db, { orgId: orgB }) });

  crossTenantSuite({
    name: "org_settings",
    scopes,
    seedInA: async (a) => a.orgId,
    read: (s, id) => s.select(orgSettings, eq(orgSettings.orgId, id)),
    update: (s, id) => s.update(orgSettings, { plan: "comped" }, eq(orgSettings.orgId, id)),
    remove: (s, id) => s.delete(orgSettings, eq(orgSettings.orgId, id)),
    raw: async (id) => (await db.select().from(orgSettings).where(eq(orgSettings.orgId, id)))[0],
  });

  crossTenantSuite({
    name: "invitation",
    scopes,
    seedInA: async (a) => {
      const [u] = await db.select({ id: user.id }).from(user).limit(1);
      const [row] = await a.insert(invitation, {
        id: crypto.randomUUID(), email: "x@a.si", role: "editor", status: "pending",
        expiresAt: new Date(Date.now() + 60_000), inviterId: u.id,
      });
      return (row as { id: string }).id;
    },
    read: (s, id) => s.select(invitation, eq(invitation.id, id)),
    update: (s, id) => s.update(invitation, { status: "canceled" }, eq(invitation.id, id)),
    remove: (s, id) => s.delete(invitation, eq(invitation.id, id)),
    raw: async (id) => (await db.select().from(invitation).where(eq(invitation.id, id)))[0],
  });

  it("insert forces the context org id even if input tries another", async () => {
    const { b } = scopes();
    const [u] = await db.select({ id: user.id }).from(user).limit(1);
    const [row] = await b.insert(invitation, {
      id: crypto.randomUUID(), organizationId: orgA, email: "y@b.si", role: "editor", status: "pending",
      expiresAt: new Date(Date.now() + 60_000), inviterId: u.id,
    });
    expect((row as { organizationId: string }).organizationId).toBe(orgB);
  });

  it("update cannot move a row to another org", async () => {
    const { a } = scopes();
    await a.update(orgSettings, { orgId: orgB, plan: "starter" }, eq(orgSettings.orgId, orgA));
    const [row] = await db.select().from(orgSettings).where(eq(orgSettings.orgId, orgA));
    expect(row.plan).toBe("starter");
    expect((await db.select().from(organization)).length).toBe(2);
  });
});
