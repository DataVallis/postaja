import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { organization } from "better-auth/plugins/organization";
import { ac, editor, owner } from "./permissions";
import type { Db } from "../db/client";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { createMailerFromEnv, type Mailer } from "../email/mailer";
import { magicLinkMail } from "../email/templates/magic-link";
import { invitationMail } from "../email/templates/invitation";
import { acceptPendingInvitations, firstMembershipOrgId, hasPendingInvitation, INVITATION_TTL_MS } from "../orgs/invitations";
import { normalizeEmail, parseEmailList } from "./emails";

export const MAGIC_LINK_TTL_SECONDS = 600;

export type AuthDeps = {
  db: Db;
  mailer: Mailer;
  secret: string;
  baseURL: string;
  superadminEmails: Set<string>;
  magicLinkTtlSeconds?: number;
  /** Magic-link requests per IP per minute (default 5). Raised only in E2E via AUTH_MAGIC_LINK_RATE_MAX. */
  magicLinkRateMax?: number;
};

/** Org roles (spec §2): owner manages members/invitations and settings; editor works on content. */
export const ORG_ROLES = ["owner", "editor"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export function isSuperadminEmail(email: string, deps: Pick<AuthDeps, "superadminEmails">): boolean {
  return deps.superadminEmails.has(normalizeEmail(email));
}

/**
 * Who may get an account (no public sign-up in v1, ADR-028):
 * - emails in SUPERADMIN_EMAILS (bootstrap, role = superadmin);
 * - emails with a pending, unexpired organization invitation.
 */
export async function canSignUp(email: string, deps: Pick<AuthDeps, "superadminEmails" | "db">): Promise<boolean> {
  return isSuperadminEmail(email, deps) || (await hasPendingInvitation(deps.db, email));
}

export function createAuth(deps: AuthDeps) {
  return betterAuth({
    secret: deps.secret,
    baseURL: deps.baseURL,
    database: drizzleAdapter(deps.db, { provider: "pg", schema }),
    emailAndPassword: { enabled: false },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "user", input: false },
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: true, window: 60, max: 100 },
    databaseHooks: {
      user: {
        create: {
          before: async (u) => {
            if (!(await canSignUp(u.email, deps))) return false;
            const role = isSuperadminEmail(u.email, deps) ? "superadmin" : "user";
            return { data: { ...u, email: normalizeEmail(u.email), role } };
          },
        },
      },
      session: {
        create: {
          // On every sign-in: accept pending invitations, then pick an active organization if none is set.
          before: async (s) => {
            const [u] = await deps.db
              .select({ email: schema.user.email })
              .from(schema.user)
              .where(eq(schema.user.id, s.userId));
            if (u) await acceptPendingInvitations(deps.db, s.userId, u.email);
            const active = (s as { activeOrganizationId?: string | null }).activeOrganizationId ?? (await firstMembershipOrgId(deps.db, s.userId));
            return { data: { ...s, activeOrganizationId: active } };
          },
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: deps.magicLinkTtlSeconds ?? MAGIC_LINK_TTL_SECONDS,
        storeToken: "hashed",
        rateLimit: { window: 60, max: deps.magicLinkRateMax ?? 5 },
        sendMagicLink: async ({ email, url }, ctx) => {
          // Only send to existing users or people allowed to sign up. Unknown emails get no mail,
          // but the API answers the same way (no account enumeration).
          const existing = await ctx?.context.internalAdapter.findUserByEmail(normalizeEmail(email));
          if (!existing?.user && !(await canSignUp(email, deps))) return;
          await deps.mailer.send(magicLinkMail(email, url));
        },
      }),
      organization({
        ac,
        roles: { owner, editor },
        creatorRole: "owner",
        // Organizations are created only by super admins through src/server/orgs/service.ts (spec §11).
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        invitationExpiresIn: INVITATION_TTL_MS / 1000,
        cancelPendingInvitationsOnReInvite: true,
        sendInvitationEmail: async ({ email, organization: org, role }) => {
          await deps.mailer.send(invitationMail(normalizeEmail(email), org.name, role, `${deps.baseURL}/login`));
        },
      }),
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let cached: Auth | undefined;

/** App-wide auth instance, created on first use so builds do not need runtime secrets. */
export function getAuth(): Auth {
  if (cached) return cached;
  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL ?? process.env.APP_URL;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  if (!baseURL) throw new Error("BETTER_AUTH_URL is not set");
  cached = createAuth({
    db: getDb(),
    mailer: createMailerFromEnv(),
    secret,
    baseURL,
    superadminEmails: parseEmailList(process.env.SUPERADMIN_EMAILS),
    magicLinkRateMax: process.env.AUTH_MAGIC_LINK_RATE_MAX ? Number(process.env.AUTH_MAGIC_LINK_RATE_MAX) : undefined,
  });
  return cached;
}
