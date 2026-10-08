// Read models for /admin. Super-admin only — callers must check the role first (requireSuperadminPage).
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditLog, invitation, member, organization, orgSettings, user } from "../db/schema";

export async function listOrganizations(db: Db) {
  return db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt,
      plan: orgSettings.plan,
      status: orgSettings.status,
      spendCapMicroUsd: orgSettings.spendCapMicroUsd,
      members: sql<number>`(select count(*)::int from ${member} where ${member.organizationId} = ${organization.id})`,
      pendingInvites: sql<number>`(select count(*)::int from ${invitation} where ${invitation.organizationId} = ${organization.id} and ${invitation.status} = 'pending' and ${invitation.expiresAt} > now())`,
    })
    .from(organization)
    .innerJoin(orgSettings, eq(orgSettings.orgId, organization.id))
    .orderBy(organization.createdAt);
}

export async function getOrganizationDetail(db: Db, orgId: string) {
  const [org] = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt,
      plan: orgSettings.plan,
      status: orgSettings.status,
      limits: orgSettings.limits,
      spendCapMicroUsd: orgSettings.spendCapMicroUsd,
    })
    .from(organization)
    .innerJoin(orgSettings, eq(orgSettings.orgId, organization.id))
    .where(eq(organization.id, orgId));
  if (!org) return null;
  const members = await db
    .select({ email: user.email, role: member.role, since: member.createdAt })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, orgId))
    .orderBy(member.createdAt);
  const invites = await db
    .select({ email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt })
    .from(invitation)
    .where(and(eq(invitation.organizationId, orgId), eq(invitation.status, "pending"), sql`${invitation.expiresAt} > now()`))
    .orderBy(invitation.createdAt);
  return { org, members, invites };
}

export async function listAudit(db: Db, limit = 100) {
  return db
    .select({
      id: auditLog.id,
      createdAt: auditLog.createdAt,
      actor: user.email,
      action: auditLog.action,
      orgName: organization.name,
      target: auditLog.target,
      meta: auditLog.meta,
    })
    .from(auditLog)
    .innerJoin(user, eq(user.id, auditLog.actorUserId))
    .leftJoin(organization, eq(organization.id, auditLog.orgId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}
