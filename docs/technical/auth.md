# Auth

Status: **Live on dev** (TASK-003a, since 2026-10-05; first real sign-in by the owner).

## How sign-in works
1. `/login` → email → `POST /api/auth/sign-in/magic-link` (Better Auth, magic-link plugin).
2. `sendMagicLink` sends a mail **only** if the user exists or may sign up (`canSignUp`); otherwise it silently does nothing. The API answer is identical either way (no account enumeration).
3. The link `GET /api/auth/magic-link/verify?token=…` is valid **10 minutes**, **single use**; the token is stored **hashed** in `verification`.
4. On first use for an allowed email the user is created; the `user.create.before` DB hook rejects every email that may not sign up, and sets `role`.
5. Rate limit: 5 magic-link requests per IP per minute (tested; `AUTH_MAGIC_LINK_RATE_MAX` raises it for E2E only).
6. Session cookie `better-auth.session_token` (30 days, refreshed daily). Server code reads identity only via `getCurrentUser()` (`src/server/auth/session.ts`).

## Who may sign up (ADR-028)
| Who | How |
|---|---|
| Super admins | email listed in `SUPERADMIN_EMAILS` (comma separated, case-insensitive) → `role = superadmin` |
| Org members | pending, unexpired invitation (accepted automatically at sign-in, see tenancy.md) |
| Anyone else | no account, no mail |

`role` is a Better Auth additional field with `input: false` — it cannot be set through any client endpoint (tested).

## Email
`src/server/email/mailer.ts`: SMTP via nodemailer (`SMTP_HOST`, `SMTP_PORT` 465 = TLS, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`); any missing variable throws on first use.
`EMAIL_TRANSPORT=file` writes mails as JSON to `MAIL_DIR` — local dev and E2E only, never on servers.
Template: `src/server/email/templates/magic-link.ts` (sl/en, brand colours, HTML-escaped link).

## Code map
| Path | What |
|---|---|
| `src/server/auth/auth.ts` | `createAuth(deps)` (testable factory) and `getAuth()` (lazy app instance) |
| `src/server/auth/emails.ts` | email normalisation, `SUPERADMIN_EMAILS` parsing |
| `src/server/auth/session.ts` | `getCurrentUser()` for server components/actions |
| `src/server/db/schema/auth.ts` | `user`, `session`, `account`, `verification` (Drizzle) |
| `src/app/api/auth/[...all]/route.ts` | Better Auth HTTP handler |
| `src/app/login/*`, `src/app/app/*` | login form, protected placeholder page, sign out |

## Tests
- Integration (`src/server/auth/auth.int.test.ts`, real Postgres): schema drift vs Better Auth, superadmin bootstrap, case-insensitive email, unknown email (no mail/user/session), single-use link, hashed token, expiry, DB-hook refusal, role not client-writable.
- E2E (`tests/e2e/auth.spec.ts`): redirect to login, a11y, full magic-link sign-in via file mailer + sign out, unknown email, bad link error.
