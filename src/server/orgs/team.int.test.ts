// Team and plan limits (TASK-028): owners invite (always a pending invitation, accepted on sign-in), cancel, change
// roles and remove members; the last owner stays; everything audited; other orgs untouchable. Limits: members (with
// invitations), brands (also on un-archiving), AI generations per month (in the spend reservation), set by the super admin.
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { createBrand, setBrandArchived } from "../brands/service";
import { auditLog, invitation, member } from "../db/schema";
import { GenerationLimitError, reserve, SpendCapError } from "../llm/spend";
import { resolveOrgContext, TenancyError, type OrgContext } from "../tenancy/context";
import { acceptPendingInvitations } from "./invitations";
import { createOrganization, updateOrgSettings } from "./service";
import { cancelInvitation, inviteToTeam, listTeam, orgUsage, removeMember, setMemberRole } from "./team";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const deps = { mailer, baseURL: "http://localhost:3000" };

let A: OrgContext, B: OrgContext, admin: { userId: string; role: "superadmin" };
beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, usage_ledger cascade`;
  const s = (await session((await signIn("boss@datavallis.com"))!))!;
  admin = { userId: s.user.id, role: "superadmin" };
  const a = await createOrganization(db, deps, admin, { name: "Org A", slug: "org-a", plan: "starter", ownerEmail: "boss@datavallis.com" });
  const b = await createOrganization(db, deps, admin, { name: "Org B", slug: "org-b", plan: "pro", ownerEmail: "b@b.si" });
  const bUser = (await session((await signIn("b@b.si"))!))!.user;
  A = { userId: s.user.id, orgId: a.orgId, orgName: "Org A", role: "owner", plan: "starter" };
  B = { userId: bUser.id, orgId: b.orgId, orgName: "Org B", role: "owner", plan: "pro" };
  mailer.sent.length = 0;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

/** Signs in `email` (accepting pending invitations) and returns their context in org A. */
async function join(email: string): Promise<OrgContext> {
  const u = (await session((await signIn(email))!))!.user;
  await acceptPendingInvitations(db, u.id, email);
  return resolveOrgContext(db, { userId: u.id, activeOrganizationId: A.orgId });
}

describe("team", () => {
  it("the owner invites by email; the person joins on sign-in with that role; audited; mail sent", async () => {
    await inviteToTeam(db, deps, A, { email: " Ana@Example.SI ", role: "editor" });
    expect(mailer.sent.map((m) => [m.to, m.subject])).toEqual([["ana@example.si", "Povabilo v Postajo: Org A"]]);
    let team = await listTeam(db, A);
    expect(team.invites.map((i) => [i.email, i.role])).toEqual([["ana@example.si", "editor"]]);
    const ana = await join("ana@example.si");
    expect(ana.role).toBe("editor");
    team = await listTeam(db, A);
    expect(team.invites).toEqual([]);
    expect(team.members.map((m) => [m.email, m.role])).toEqual([["boss@datavallis.com", "owner"], ["ana@example.si", "editor"]]);
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "team.invite"))).map((a) => [a.actorUserId, a.orgId, a.target])).toEqual([[A.userId, A.orgId, "ana@example.si"]]);
    await expect(inviteToTeam(db, deps, A, { email: "ana@example.si", role: "owner" })).rejects.toMatchObject({ code: "ALREADY_MEMBER" });
  });

  it("editors cannot change the team; a bad email is refused", async () => {
    await inviteToTeam(db, deps, A, { email: "ed@a.si", role: "editor" });
    const ed = await join("ed@a.si");
    await expect(inviteToTeam(db, deps, ed, { email: "x@a.si", role: "owner" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [m] = (await listTeam(db, A)).members.filter((x) => x.email === "ed@a.si");
    await expect(setMemberRole(db, ed, m.id, "owner")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(removeMember(db, ed, m.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(inviteToTeam(db, deps, A, { email: "not-an-email", role: "editor" })).rejects.toMatchObject({ code: "INVALID" });
  });

  it("re-inviting replaces the pending invitation; cancelling withdraws it", async () => {
    await inviteToTeam(db, deps, A, { email: "ana@example.si", role: "editor" });
    await inviteToTeam(db, deps, A, { email: "ana@example.si", role: "owner" });
    const { invites } = await listTeam(db, A);
    expect(invites.map((i) => i.role)).toEqual(["owner"]);
    await cancelInvitation(db, A, invites[0].id);
    expect((await listTeam(db, A)).invites).toEqual([]);
    await expect(cancelInvitation(db, A, invites[0].id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("roles change; the last owner can be neither demoted nor removed; a removed member loses access", async () => {
    await inviteToTeam(db, deps, A, { email: "ana@example.si", role: "editor" });
    const ana = await join("ana@example.si");
    const ids = Object.fromEntries((await listTeam(db, A)).members.map((m) => [m.email, m.id]));
    await expect(setMemberRole(db, A, ids["boss@datavallis.com"], "editor")).rejects.toMatchObject({ code: "LAST_OWNER" });
    await expect(removeMember(db, A, ids["boss@datavallis.com"])).rejects.toMatchObject({ code: "LAST_OWNER" });
    await setMemberRole(db, A, ids["ana@example.si"], "owner");
    await setMemberRole(db, A, ids["boss@datavallis.com"], "editor"); // now allowed: Ana is an owner
    await expect(setMemberRole(db, A, ids["ana@example.si"], "boss")).rejects.toBeDefined();
    const anaOwner = await resolveOrgContext(db, { userId: ana.userId, activeOrganizationId: A.orgId });
    expect(anaOwner.role).toBe("owner");
    await removeMember(db, anaOwner, ids["boss@datavallis.com"]);
    await expect(resolveOrgContext(db, { userId: A.userId, activeOrganizationId: A.orgId })).rejects.toBeInstanceOf(TenancyError);
    expect((await db.select().from(auditLog)).map((a) => a.action).filter((x) => x.startsWith("team."))).toEqual(["team.invite", "team.role", "team.role", "team.remove"]);
  });

  it("another organization's members and invitations are out of reach", async () => {
    await inviteToTeam(db, deps, B, { email: "x@b.si", role: "editor" });
    const bTeam = await listTeam(db, B);
    expect((await listTeam(db, A)).members.map((m) => m.email)).toEqual(["boss@datavallis.com"]);
    await expect(removeMember(db, A, bTeam.members[0].id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setMemberRole(db, A, bTeam.members[0].id, "editor")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(cancelInvitation(db, A, bTeam.invites[0].id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(member).where(eq(member.organizationId, B.orgId))).toHaveLength(1);
    expect((await db.select().from(invitation).where(eq(invitation.email, "x@b.si")))[0].status).toBe("pending");
  });
});

describe("plan limits", () => {
  it("members: members and pending invitations count; set by the super admin and audited", async () => {
    await updateOrgSettings(db, admin, A.orgId, { limits: { members: 2 } });
    await inviteToTeam(db, deps, A, { email: "one@a.si", role: "editor" });
    await expect(inviteToTeam(db, deps, A, { email: "two@a.si", role: "editor" })).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    // Re-inviting the same person replaces their invitation, so it fits.
    await inviteToTeam(db, deps, A, { email: "one@a.si", role: "owner" });
    const [a] = await db.select().from(auditLog).where(eq(auditLog.action, "org.settings.update"));
    expect(a.meta).toMatchObject({ limits: { from: "{}", to: '{"members":2}' } });
    await expect(updateOrgSettings(db, admin, A.orgId, { limits: { members: 0 } })).rejects.toBeDefined();
    await expect(updateOrgSettings(db, admin, A.orgId, { limits: { seats: 3 } as never })).rejects.toBeDefined();
  });

  it("brands: not archived ones count, also when a brand is brought back", async () => {
    await updateOrgSettings(db, admin, A.orgId, { limits: { brands: 1 } });
    const first = (await createBrand(db, A, { name: "Ena", slug: "ena", languages: ["sl"] })).id;
    await expect(createBrand(db, A, { name: "Dva", slug: "dva", languages: ["sl"] })).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    await setBrandArchived(db, A, first, true);
    await createBrand(db, A, { name: "Dva", slug: "dva", languages: ["sl"] });
    await expect(setBrandArchived(db, A, first, false)).rejects.toMatchObject({ code: "LIMIT_REACHED" });
  });

  it("AI generations per month: each paid call counts; the next one is refused like the spend cap", async () => {
    await updateOrgSettings(db, admin, A.orgId, { limits: { generationsPerMonth: 2 } });
    const call = () => reserve(db, { orgId: A.orgId, brandId: null, postId: null, provider: "fal", model: "m", estimate: 1000n });
    await call();
    await call();
    const err = await call().catch((e) => e);
    expect(err).toBeInstanceOf(GenerationLimitError);
    expect(err).toBeInstanceOf(SpendCapError);
    expect(err).toMatchObject({ used: 2, limit: 2 });
    // Other organizations are unaffected; last month's calls do not count.
    await reserve(db, { orgId: B.orgId, brandId: null, postId: null, provider: "fal", model: "m", estimate: 1000n });
    await sql`update usage_ledger set created_at = now() - interval '40 days' where org_id = ${A.orgId}`;
    await call();
    const u = await orgUsage(db, A);
    expect(u).toMatchObject({ plan: "starter", limits: { generationsPerMonth: 2 }, generations: 1, brands: 0, members: 1, invites: 0 });
  });
});
