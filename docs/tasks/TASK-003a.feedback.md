# TASK-003a feedback
Status: **DONE** locally; merge waits for the owner's GitHub variable `SUPERADMIN_EMAILS` (deploy reads it; missing = deploy fails loudly).

## What I implemented
- Better Auth 1.7.7 with Drizzle tables `user` (+ `role`), `session`, `account`, `verification` (migration `0001_auth_tables`).
- Magic link only: 10 min, single use, token stored hashed; unknown emails get no mail and the same API answer.
- Sign-up gate in two places: `sendMagicLink` and the `user.create.before` DB hook (`canSignUp` = `SUPERADMIN_EMAILS` for now).
- `role` additional field, `input: false`; superadmin set by the hook for bootstrap emails.
- SMTP mailer (nodemailer, port 465 TLS) + file transport for dev/E2E; sl/en HTML+text template.
- `/login` (form, error state), protected `/app` (email, super admin badge, sign out), `/api/auth/*` handler.
- Startup migrations moved to `src/instrumentation-node.ts` (removes Edge-runtime build warnings).
- Deploy: new env (`BETTER_AUTH_URL`, `SMTP_*`, `EMAIL_FROM`, `SUPERADMIN_EMAILS`) and secrets (`BETTER_AUTH_SECRET`, `SMTP_PASSWORD`).

## Deviations
- Better Auth **admin plugin not used** (ADR-028): super admin is a plain `role` field; our own audited admin endpoints come in 003c.
- No password login in v1 (ADR-028).
- Spec TASK-003 split into 003a/b/c (size rule).

## New dependencies
better-auth@1.7.7 (ADR-004), nodemailer@10.0.15 (SMTP, ADR-028), @types/nodemailer@8.0.2 (dev).

## Test results (real outputs, this session)
```
2026-10-05T18:03:24+02:00
$ pnpm lint
lint: 0 problems
$ pnpm typecheck
typecheck: ok
$ pnpm test
 Test Files  4 passed (4)
      Tests  19 passed (19)
$ pnpm test:int
 Test Files  2 passed (2)
      Tests  14 passed (14)
$ pnpm build
✓ Compiled successfully in 685ms
├ ƒ /api/auth/[...all]
├ ƒ /app
└ ƒ /login
$ pnpm test:e2e
  18 passed (15.7s)
```

## Deliberate breaks (each guard removed once → its test fails → restored)
```
2026-10-05T18:01:58+02:00
## Break A: sendMagicLink sends to anyone
     × unknown email: same API answer, no mail, no user, no session 32ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 13 passed (14)
## Break B: DB hook lets anyone sign up
     × account creation for a non-allowed email is refused at the DB hook (even with a forged flow) 22ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 13 passed (14)
## Break C: role writable from client
     × role cannot be set from the client 71ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 13 passed (14)
## Restored
      Tests  14 passed (14)
```

## NOT RUN
- Real SMTP send to mail.datavallis.com — NOT RUN from the sandbox (outbound SMTP blocked). First real mail = owner's first login on dev after deploy.

## Docs updated
docs/technical/auth.md (new), technical/README.md, 02-ARCHITECTURE.md (auth row, env names), 03-DECISIONS.md (ADR-028), CHEATSHEET.md, tasks/README.md, tasks/TASK-003-auth-orgs-admin.md, .env.example.

## Owner actions
- GitHub → Settings → Secrets and variables → Actions → Variables → `SUPERADMIN_EMAILS` = your login email.
- After deploy: sign in at https://dev-postaja.inzenirji.si/login — the mail comes from hello@inzenirji.si (check spam the first time).
