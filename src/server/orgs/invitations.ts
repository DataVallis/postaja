import { and, eq, gt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { invitation, member } from "../db/schema";
import { normalizeEmail } from "../auth/emails";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** True if the email has at least one pending, unexpired invitation. */
export async function hasPendingInvitation(db: Db, email: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(and(sql`lower(${invitation.email}) = ${normalizeEmail(email)}`, eq(invitation.status, "pending"), gt(invitation.expiresAt, now)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Accepts every pending, unexpired invitation for this user's email: creates the membership (idempotent)
 * and marks the invitation accepted. Returns the organization ids joined.
 */
export async function acceptPendingInvitations(db: Db, userId: string, email: string, now = new Date()): Promise<string[]> {
  return db.transaction(async (tx) => {
    const pending = await tx
      .select()
      .from(invitation)
      .where(and(sql`lower(${invitation.email}) = ${normalizeEmail(email)}`, eq(invitation.status, "pending"), gt(invitation.expiresAt, now)))
      .for("update");
    const joined: string[] = [];
    for (const inv of pending) {
      await tx
        .insert(member)
        .values({ id: crypto.randomUUID(), organizationId: inv.organizationId, userId, role: inv.role })
        .onConflictDoNothing({ target: [member.organizationId, member.userId] });
      await tx.update(invitation).set({ status: "accepted" }).where(eq(invitation.id, inv.id));
      joined.push(inv.organizationId);
    }
    return joined;
  });
}

/** First organization the user belongs to (oldest membership), or null. */
export async function firstMembershipOrgId(db: Db, userId: string): Promise<string | null> {
  const rows = await db
    .select({ orgId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(member.createdAt)
    .limit(1);
  return rows[0]?.orgId ?? null;
}
