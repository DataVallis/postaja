import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { member, organization, orgSettings, type Plan } from "../db/schema";
import type { OrgRole } from "../auth/auth";

export type OrgContext = {
  userId: string;
  orgId: string;
  orgName: string;
  role: OrgRole;
  plan: Plan;
};

export class TenancyError extends Error {
  constructor(public readonly code: "NO_ACTIVE_ORG" | "NOT_A_MEMBER" | "ORG_SUSPENDED" | "ORG_NOT_FOUND") {
    super(code);
  }
}

/**
 * Resolves the tenant for a request. Identity comes only from the verified session:
 * the active org id in the session is re-checked against `member` on every call, and suspended orgs are refused.
 */
export async function resolveOrgContext(
  db: Db,
  session: { userId: string; activeOrganizationId?: string | null },
): Promise<OrgContext> {
  const orgId = session.activeOrganizationId;
  if (!orgId) throw new TenancyError("NO_ACTIVE_ORG");
  const rows = await db
    .select({ role: member.role, orgName: organization.name, plan: orgSettings.plan, status: orgSettings.status })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .leftJoin(orgSettings, eq(orgSettings.orgId, member.organizationId))
    .where(and(eq(member.organizationId, orgId), eq(member.userId, session.userId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new TenancyError("NOT_A_MEMBER");
  if (!row.plan || !row.status) throw new TenancyError("ORG_NOT_FOUND");
  if (row.status !== "active") throw new TenancyError("ORG_SUSPENDED");
  const role: OrgRole = row.role === "owner" ? "owner" : "editor";
  return { userId: session.userId, orgId, orgName: row.orgName, role, plan: row.plan };
}
