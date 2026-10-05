import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { invitation, member, organization, orgSettings, PLANS, user } from "../db/schema";
import { normalizeEmail } from "../auth/emails";
import type { Mailer } from "../email/mailer";
import { invitationMail } from "../email/templates/invitation";
import { INVITATION_TTL_MS } from "./invitations";

export class ForbiddenError extends Error {
  constructor() {
    super("FORBIDDEN");
  }
}

export type Actor = { userId: string; role: "user" | "superadmin" };

function requireSuperadmin(actor: Actor) {
  if (actor.role !== "superadmin") throw new ForbiddenError();
}

export const createOrganizationInput = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/, "slug: a-z, 0-9, dashes; 1–48 chars"),
  plan: z.enum(PLANS),
  ownerEmail: z.email().transform(normalizeEmail),
  spendCapMicroUsd: z.bigint().nonnegative().optional(),
});

/**
 * Super admin only. Creates organization + org_settings. If the owner already has an account they become
 * owner immediately; otherwise an owner invitation is created and emailed (they sign up by accepting it).
 */
export async function createOrganization(
  db: Db,
  deps: { mailer: Mailer; baseURL: string },
  actor: Actor,
  input: z.input<typeof createOrganizationInput>,
) {
  requireSuperadmin(actor);
  const data = createOrganizationInput.parse(input);
  const orgId = crypto.randomUUID();
  const result = await db.transaction(async (tx) => {
    await tx.insert(organization).values({ id: orgId, name: data.name, slug: data.slug });
    await tx.insert(orgSettings).values({
      orgId,
      plan: data.plan,
      ...(data.spendCapMicroUsd !== undefined ? { spendCapMicroUsd: data.spendCapMicroUsd } : {}),
    });
    const [existing] = await tx.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${data.ownerEmail}`);
    if (existing) {
      await tx.insert(member).values({ id: crypto.randomUUID(), organizationId: orgId, userId: existing.id, role: "owner" });
      return { orgId, ownerStatus: "member" as const };
    }
    await tx.insert(invitation).values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      email: data.ownerEmail,
      role: "owner",
      status: "pending",
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      inviterId: actor.userId,
    });
    return { orgId, ownerStatus: "invited" as const };
  });
  if (result.ownerStatus === "invited") {
    await deps.mailer.send(invitationMail(data.ownerEmail, data.name, "owner", `${deps.baseURL}/login`));
  }
  return result;
}

/** Super admin only: change plan, status or spend cap. */
export async function updateOrgSettings(
  db: Db,
  actor: Actor,
  orgId: string,
  patch: { plan?: (typeof PLANS)[number]; status?: "active" | "suspended"; spendCapMicroUsd?: bigint },
) {
  requireSuperadmin(actor);
  const parsed = z
    .object({
      plan: z.enum(PLANS).optional(),
      status: z.enum(["active", "suspended"]).optional(),
      spendCapMicroUsd: z.bigint().nonnegative().optional(),
    })
    .strict()
    .parse(patch);
  const rows = await db
    .update(orgSettings)
    .set({ ...parsed, updatedAt: new Date() })
    .where(eq(orgSettings.orgId, orgId))
    .returning();
  if (!rows[0]) throw new Error("ORG_NOT_FOUND");
  return rows[0];
}
