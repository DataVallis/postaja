import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import type { Db } from "../db/client";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { createMailerFromEnv, type Mailer } from "../email/mailer";
import { magicLinkMail } from "../email/templates/magic-link";
import { normalizeEmail, parseEmailList } from "./emails";

export const MAGIC_LINK_TTL_SECONDS = 600;

export type AuthDeps = {
  db: Db;
  mailer: Mailer;
  secret: string;
  baseURL: string;
  superadminEmails: Set<string>;
  magicLinkTtlSeconds?: number;
};

/**
 * Who may get an account (no public sign-up in v1, spec §12):
 * - emails in SUPERADMIN_EMAILS (bootstrap, role = superadmin);
 * - later: emails with a pending organization invitation (TASK-003b).
 */
export function canSignUp(email: string, deps: Pick<AuthDeps, "superadminEmails">): boolean {
  return deps.superadminEmails.has(normalizeEmail(email));
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
            if (!canSignUp(u.email, deps)) return false;
            const role = deps.superadminEmails.has(normalizeEmail(u.email)) ? "superadmin" : "user";
            return { data: { ...u, email: normalizeEmail(u.email), role } };
          },
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: deps.magicLinkTtlSeconds ?? MAGIC_LINK_TTL_SECONDS,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }, ctx) => {
          // Only send to existing users or people allowed to sign up. Unknown emails get no mail,
          // but the API answers the same way (no account enumeration).
          const existing = await ctx?.context.internalAdapter.findUserByEmail(normalizeEmail(email));
          if (!existing?.user && !canSignUp(email, deps)) return;
          await deps.mailer.send(magicLinkMail(email, url));
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
  });
  return cached;
}
