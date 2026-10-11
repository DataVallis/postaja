// Team (TASK-028): the organization's owner invites and removes members and changes their roles — before this only
// the super admin could. Every member sees the team; only owners change it. Invitations are always pending (accepted on
// the person's next sign-in, existing account or not) and count against the plan's member limit. Every change is
// audited. An organization always keeps at least one owner.
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { auditLog, brands, invitation, member, organization, orgSettings, user } from "../db/schema";
import { generationsThisMonth, monthToDate } from "../llm/spend";
import { normalizeEmail } from "../auth/emails";
import type { Mailer } from "../email/mailer";
import { invitationMail } from "../email/templates/invitation";
import type { OrgContext } from "../tenancy/context";
import { INVITATION_TTL_MS } from "./invitations";

export class TeamError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "INVALID" | "NOT_FOUND" | "ALREADY_MEMBER" | "LIMIT_REACHED" | "LAST_OWNER") {
    super(code);
  }
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const audit = (tx: Tx, ctx: OrgContext, action: string, target: string, meta: Record<string, unknown>) =>
  tx.insert(auditLog).values({ id: crypto.randomUUID(), actorUserId: ctx.userId, orgId: ctx.orgId, action, target, meta });

function requireOwner(ctx: OrgContext) {
  if (ctx.role !== "owner") throw new TeamError("FORBIDDEN");
}

/** Members and pending invitations of the caller's organization (any member). */
export async function listTeam(db: Db, ctx: OrgContext, now = new Date()) {
  const members = await db
    .select({ id: member.id, userId: member.userId, role: member.role, since: member.createdAt, email: user.email, name: user.name })
    .from(member).innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, ctx.orgId))
    .orderBy(member.createdAt);
  const invites = await db
    .select({ id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt })
    .from(invitation)
    .where(and(eq(invitation.organizationId, ctx.orgId), eq(invitation.status, "pending"), gt(invitation.expiresAt, now)))
    .orderBy(invitation.createdAt);
  return { members, invites };
}

const inviteInput = z.object({ email: z.string().trim().pipe(z.email()).transform(normalizeEmail), role: z.enum(["owner", "editor"]) });

/** Owner: invite someone by email. Refused when they are a member already or the member limit is reached. */
export async function inviteToTeam(db: Db, deps: { mailer: Mailer; baseURL: string }, ctx: OrgContext, input: z.input<typeof inviteInput>, now = new Date()) {
  requireOwner(ctx);
  const parsed = inviteInput.safeParse(input);
  if (!parsed.success) throw new TeamError("INVALID");
  const { email, role } = parsed.data;
  const orgName = await db.transaction(async (tx) => {
    // The settings row is locked so two invitations cannot pass the limit together.
    const [s] = await tx.select({ limits: orgSettings.limits }).from(orgSettings).where(eq(orgSettings.orgId, ctx.orgId)).for("update");
    const [org] = await tx.select({ name: organization.name }).from(organization).where(eq(organization.id, ctx.orgId));
    if (!s || !org) throw new TeamError("NOT_FOUND");
    const [already] = await tx.select({ id: member.id }).from(member).innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, ctx.orgId), sql`lower(${user.email}) = ${email}`));
    if (already) throw new TeamError("ALREADY_MEMBER");
    await tx.update(invitation).set({ status: "canceled" })
      .where(sql`${invitation.organizationId} = ${ctx.orgId} and lower(${invitation.email}) = ${email} and ${invitation.status} = 'pending'`);
    const max = s.limits?.members;
    if (max !== undefined) {
      const [{ m }] = await tx.select({ m: sql<number>`count(*)::int` }).from(member).where(eq(member.organizationId, ctx.orgId));
      const [{ i }] = await tx.select({ i: sql<number>`count(*)::int` }).from(invitation)
        .where(and(eq(invitation.organizationId, ctx.orgId), eq(invitation.status, "pending"), gt(invitation.expiresAt, now)));
      if (m + i >= max) throw new TeamError("LIMIT_REACHED");
    }
    await tx.insert(invitation).values({
      id: crypto.randomUUID(), organizationId: ctx.orgId, email, role, status: "pending", expiresAt: new Date(now.getTime() + INVITATION_TTL_MS), inviterId: ctx.userId,
    });
    await audit(tx, ctx, "team.invite", email, { role });
    return org.name;
  });
  await deps.mailer.send(invitationMail(email, orgName, role, `${deps.baseURL}/login`));
}

/** Owner: withdraw a pending invitation. */
export async function cancelInvitation(db: Db, ctx: OrgContext, invitationId: string) {
  requireOwner(ctx);
  await db.transaction(async (tx) => {
    const [inv] = await tx.update(invitation).set({ status: "canceled" })
      .where(and(eq(invitation.id, invitationId), eq(invitation.organizationId, ctx.orgId), eq(invitation.status, "pending")))
      .returning({ email: invitation.email });
    if (!inv) throw new TeamError("NOT_FOUND");
    await audit(tx, ctx, "team.invite.cancel", inv.email, {});
  });
}

/** The member row of this organization, locked, with the number of owners (for the last-owner rule). */
async function memberFor(tx: Tx, ctx: OrgContext, memberId: string) {
  const owners = await tx.select({ id: member.id }).from(member).where(and(eq(member.organizationId, ctx.orgId), eq(member.role, "owner"))).for("update");
  const [m] = await tx.select({ id: member.id, role: member.role, email: user.email }).from(member).innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.id, memberId), eq(member.organizationId, ctx.orgId)));
  if (!m) throw new TeamError("NOT_FOUND");
  return { m, owners: owners.length };
}

const roleInput = z.enum(["owner", "editor"]);

/** Owner: make a member owner or editor. The last owner cannot become an editor. */
export async function setMemberRole(db: Db, ctx: OrgContext, memberId: string, role: string) {
  requireOwner(ctx);
  const r = roleInput.safeParse(role);
  if (!r.success) throw new TeamError("INVALID");
  await db.transaction(async (tx) => {
    const { m, owners } = await memberFor(tx, ctx, memberId);
    if (m.role === r.data) return;
    if (m.role === "owner" && owners <= 1) throw new TeamError("LAST_OWNER");
    await tx.update(member).set({ role: r.data }).where(eq(member.id, m.id));
    await audit(tx, ctx, "team.role", m.email, { from: m.role, to: r.data });
  });
}

/** Owner: remove a member (also oneself, while another owner remains). Their sessions lose the organization. */
export async function removeMember(db: Db, ctx: OrgContext, memberId: string) {
  requireOwner(ctx);
  await db.transaction(async (tx) => {
    const { m, owners } = await memberFor(tx, ctx, memberId);
    if (m.role === "owner" && owners <= 1) throw new TeamError("LAST_OWNER");
    await tx.delete(member).where(eq(member.id, m.id));
    await audit(tx, ctx, "team.remove", m.email, { role: m.role });
  });
}

/** The plan, its limits and this month's use (any member; shown on the team page). */
export async function orgUsage(db: Db, ctx: OrgContext, now = new Date()) {
  const [s] = await db.select({ plan: orgSettings.plan, limits: orgSettings.limits, cap: orgSettings.spendCapMicroUsd }).from(orgSettings).where(eq(orgSettings.orgId, ctx.orgId));
  const [{ b }] = await db.select({ b: sql<number>`count(*)::int` }).from(brands).where(and(eq(brands.orgId, ctx.orgId), isNull(brands.archivedAt)));
  const [{ m }] = await db.select({ m: sql<number>`count(*)::int` }).from(member).where(eq(member.organizationId, ctx.orgId));
  const [{ i }] = await db.select({ i: sql<number>`count(*)::int` }).from(invitation)
    .where(and(eq(invitation.organizationId, ctx.orgId), eq(invitation.status, "pending"), gt(invitation.expiresAt, now)));
  return {
    plan: s?.plan ?? "trial", limits: s?.limits ?? {}, capMicroUsd: s?.cap ?? 0n,
    brands: b, members: m, invites: i, generations: await generationsThisMonth(db, ctx.orgId, now), spentMicroUsd: await monthToDate(db, ctx.orgId, now),
  };
}
