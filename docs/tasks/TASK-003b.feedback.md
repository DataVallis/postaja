# TASK-003b feedback
Status: **DONE** (PR to dev).

## What I implemented
- Migration `0002_organizations` (additive): `organization`, `member`, `invitation`, `org_settings` (CHECKs), `session.active_organization_id`.
- Better Auth organization plugin: roles owner/editor (own access control), no client org creation, no deletion, invitation mails via our SMTP template.
- `canSignUp` = super admin email **or** pending unexpired invitation; session-create hook accepts invitations and sets the active org.
- `resolveOrgContext` (membership + status re-check), `forOrg` scoped CRUD, `createOrganization` / `updateOrgSettings` (super admin only, zod-validated).
- `/app` shows organization, role and plan, or "no organization" / "suspended".
- Reusable `crossTenantSuite` harness, applied to `org_settings` and `invitation`.

## Deviations
- "Data Vallis seed" moved to 003c: the org is created through `/admin` instead of a seed script (no hard-coded tenant in code).
- `tsconfig` target ES2017 → ES2022 (BigInt literals for micro-USD money, ADR-015).

## Test results (real outputs, this session)
```
2026-10-05T18:22:32+02:00
$ pnpm lint
lint: 0 problems
$ pnpm typecheck
typecheck: ok
$ pnpm test
 Test Files  4 passed (4)
      Tests  19 passed (19)
$ pnpm test:int
 Test Files  3 passed (3)
      Tests  34 passed (34)
$ pnpm build
build warnings+errors: 0
$ pnpm test:e2e
  18 passed (16.2s)
$ migrations applied at server start
3
```

## Deliberate breaks
```
2026-10-05T18:21:12+02:00
## Break A: forOrg ignores the org filter
     × org_settings: org B cannot read org A's row 62ms
     × org_settings: org B cannot update org A's row (0 rows, data unchanged) 58ms
     × org_settings: org B cannot delete org A's row (row still exists) 62ms
     × invitation: org B cannot read org A's row 58ms
     × invitation: org B cannot update org A's row (0 rows, data unchanged) 57ms
     × invitation: org B cannot delete org A's row (row still exists) 59ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯
      Tests  6 failed | 28 passed (34)
## Break B: insert does not force org id
     × insert forces the context org id even if input tries another 64ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 33 passed (34)
## Break C: context trusts session org without membership check
      Tests  34 passed (34)
## Break D: expired invitations still allow sign-up
     × expired invitation does not allow sign-up (no mail, no user) 66ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 33 passed (34)
## Restored
      Tests  34 passed (34)
```
Break C was **not caught** at first — the forged-org test had no real members in org A. Test strengthened (A has a real member, B's user forges A), then:
```
2026-10-05T18:22:04+02:00
## Break C (after strengthening the test): context trusts session org without membership check
     × rejects a forged active org: member of B pointing the session at A (A has real members) 99ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 33 passed (34)
## Restored
      Tests  34 passed (34)
```

## NOT RUN
- Invitation flow in the browser (E2E) — needs the `/admin` UI from 003c; covered by integration tests through the real Better Auth endpoints.

## Docs updated
technical/tenancy.md (new), technical/auth.md, technical/README.md, 02-ARCHITECTURE.md §3, 03-DECISIONS.md (ADR-029), tasks/README.md, HANDOFF.md.
