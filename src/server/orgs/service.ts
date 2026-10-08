import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { auditLog, invitation, member, organization, orgSettings, PLANS, user } from "../db/schema";
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

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Every super-admin action writes one audit row in the same transaction as the change (spec §11). */
async function audit(tx: Tx, actor: Actor, action: string, orgId: string | null, target: string | null, meta: Record<string, unknown>) {
  await tx.insert(auditLog).values({ id: crypto.randomUUID(), actorUserId: actor.userId, orgId, action, target, meta });
}

/** JSON-safe copy (bigint → string) for audit meta. */
const jsonSafe = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));

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
      await audit(tx, actor, "org.create", orgId, data.slug, jsonSafe({ name: data.name, plan: data.plan, owner: data.ownerEmail, ownerStatus: "member", spendCapMicroUsd: data.spendCapMicroUsd }));
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
    await audit(tx, actor, "org.create", orgId, data.slug, jsonSafe({ name: data.name, plan: data.plan, owner: data.ownerEmail, ownerStatus: "invited", spendCapMicroUsd: data.spendCapMicroUsd }));
    return { orgId, ownerStatus: "invited" as const };
  });
  if (result.ownerStatus === "invited") {
    await deps.mailer.send(invitationMail(data.ownerEmail, data.name, "owner", `${deps.baseURL}/login`));
  }
  return result;
}

/** Plan limits (TASK-028): a missing key means unlimited. */
export type OrgLimits = { brands?: number; members?: number; generationsPerMonth?: number };
const limitsInput = z.object({
  brands: z.number().int().min(0).max(10_000).optional(),
  members: z.number().int().min(1).max(10_000).optional(),
  generationsPerMonth: z.number().int().min(0).max(10_000_000).optional(),
}).strict();

/** Super admin only: change plan, status, spend cap or limits. */
export async function updateOrgSettings(
  db: Db,
  actor: Actor,
  orgId: string,
  patch: { plan?: (typeof PLANS)[number]; status?: "active" | "suspended"; spendCapMicroUsd?: bigint; limits?: OrgLimits },
) {
  requireSuperadmin(actor);
  const parsed = z
    .object({
      plan: z.enum(PLANS).optional(),
      status: z.enum(["active", "suspended"]).optional(),
      spendCapMicroUsd: z.bigint().nonnegative().optional(),
      limits: limitsInput.optional(),
    })
    .strict()
    .parse(patch);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(orgSettings).where(eq(orgSettings.orgId, orgId)).for("update");
    if (!before) throw new Error("ORG_NOT_FOUND");
    const [after] = await tx
      .update(orgSettings)
      .set({ ...parsed, updatedAt: new Date() })
      .where(eq(orgSettings.orgId, orgId))
      .returning();
    const show = (v: unknown) => (v !== null && typeof v === "object" ? JSON.stringify(v) : String(v));
    const changes = Object.fromEntries(
      Object.keys(parsed).map((k) => [k, { from: show(before[k as keyof typeof before]), to: show(after[k as keyof typeof after]) }]),
    );
    await audit(tx, actor, "org.settings.update", orgId, null, changes);
    return after;
  });
}

export const inviteMemberInput = z.object({
  email: z.email().transform(normalizeEmail),
  role: z.enum(["owner", "editor"]),
});

/**
 * Super admin only: add someone to an organization. Existing account → member now (role updated if already a member);
 * otherwise a pending invitation (previous pending ones for the same email in this org are canceled) + email.
 */
export async function inviteMember(
  db: Db,
  deps: { mailer: Mailer; baseURL: string },
  actor: Actor,
  orgId: string,
  input: z.input<typeof inviteMemberInput>,
) {
  requireSuperadmin(actor);
  const data = inviteMemberInput.parse(input);
  const result = await db.transaction(async (tx) => {
    const [org] = await tx.select({ name: organization.name }).from(organization).where(eq(organization.id, orgId));
    if (!org) throw new Error("ORG_NOT_FOUND");
    const [existing] = await tx.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${data.email}`);
    if (existing) {
      await tx
        .insert(member)
        .values({ id: crypto.randomUUID(), organizationId: orgId, userId: existing.id, role: data.role })
        .onConflictDoUpdate({ target: [member.organizationId, member.userId], set: { role: data.role } });
      await audit(tx, actor, "member.add", orgId, data.email, { role: data.role });
      return { status: "member" as const, orgName: org.name };
    }
    await tx
      .update(invitation)
      .set({ status: "canceled" })
      .where(sql`${invitation.organizationId} = ${orgId} and lower(${invitation.email}) = ${data.email} and ${invitation.status} = 'pending'`);
    await tx.insert(invitation).values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      email: data.email,
      role: data.role,
      status: "pending",
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      inviterId: actor.userId,
    });
    await audit(tx, actor, "member.invite", orgId, data.email, { role: data.role });
    return { status: "invited" as const, orgName: org.name };
  });
  if (result.status === "invited") {
    await deps.mailer.send(invitationMail(data.email, result.orgName, data.role, `${deps.baseURL}/login`));
  }
  return { status: result.status };
}
