# TASK-003c feedback
Status: **DONE** (PR to dev).

## What I implemented
- `audit_log` table (migration `0003_audit_log`, additive); audit row written in the same transaction as each change.
- Services: `createOrganization` + `updateOrgSettings` now audited; new `inviteMember` (existing user → member / role update; else invitation, previous pending canceled, mail).
- `/admin`, `/admin/orgs/new`, `/admin/orgs/[id]`, `/admin/audit` with `requireSuperadmin()` in layout, pages and every server action (404 for everyone else).
- USD ↔ micro-USD conversion without floats; admin forms with validation messages (sl/en).
- `/app`: admin link for super admins; falls back to first membership when the session has no active org.
- Magic-link rate limit made configurable for E2E only; default 5/min now covered by a test.

## Deviations
- Data Vallis is created by the owner in `/admin` (not seeded) — keeps tenant data out of code.

## Test results (real outputs, this session)
```
2026-10-05T19:00:34+02:00
$ pnpm lint
lint: 0 problems
$ pnpm typecheck
typecheck: ok
$ pnpm test
 Test Files  5 passed (5)
      Tests  43 passed (43)
$ pnpm test:int
 Test Files  4 passed (4)
      Tests  43 passed (43)
$ pnpm build
build warnings+errors: 0
$ pnpm test:e2e
  1 skipped
  21 passed (20.9s)
```

## Deliberate breaks
```
2026-10-05T18:56:21+02:00
## Break A: /admin guard lets any signed-in user in
  ✘  1 [desktop] › tests/e2e/admin.spec.ts:31:5 › super admin creates an organization, sets the plan, invites an editor; invitee joins; non-admins get 404 (4.7s)
    Expected: 404
    Received: 200
  1 failed
  2 passed (9.3s)
## Break B: settings change without audit row
     × updateOrgSettings audits from → to for each changed field 89ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 41 passed (42)
## Break C: inviteMember without super admin check
     × refused actions write nothing — no change, no audit row 113ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 41 passed (42)
## Restored
      Tests  42 passed (42)
  3 passed (8.3s)
```

## Found while testing
- Full E2E run failed (4 tests) although each spec passed alone: (1) both specs used the same super admin, so the admin spec's org broke auth.spec's "no organization" check; (2) 6+ magic-link calls/min from one IP hit the 5/min limit (429). Fixed with a second E2E super admin and `AUTH_MAGIC_LINK_RATE_MAX` (E2E only); production limit unchanged and now tested.

## Docs updated
technical/admin.md (new), technical/auth.md, technical/tenancy.md, technical/README.md, tasks/README.md, HANDOFF.md, .env.example.
