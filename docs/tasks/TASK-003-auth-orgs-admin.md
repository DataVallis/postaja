# TASK-003 — Auth, organizations, super admin
Depends on: TASK-002
Read first: docs/00-MANIFEST.md (§4 rule 1), ADR-004, ADR-005, ADR-013, ADR-028, docs/02-ARCHITECTURE.md §3–§4, docs/01-PRODUCT-SPEC.md §2, §11

Split to keep PRs reviewable:

## 003a — Magic-link sign-in (this PR)
- Better Auth + Drizzle tables `user/session/account/verification`, magic link (10 min, single use, hashed), no passwords.
- Sign-up allowed only for `SUPERADMIN_EMAILS` (role superadmin); unknown emails get no mail, same API answer.
- SMTP mailer (+ file transport for dev/E2E), sl/en template. `/login`, protected `/app`, sign out.
- Tests: integration (real DB) for every guard + deliberate breaks; E2E full sign-in.

## 003b — Organizations and tenant isolation
- Better Auth organization plugin (owner/editor roles), `org_settings` (plan, status, spend cap, limits), active org in session.
- `forOrg(ctx)` scoped data access; **cross-tenant test harness** reused by every later resource.
- Invitations: invited emails may sign up (extends `canSignUp`). Seed: organization **Data Vallis**, plan `comped`, owner = first super admin.

## 003c — Super admin basics
- `/admin` (role guard): organizations list/create/suspend, plan + spend cap, invite owner; `audit_log` for every action.

## Acceptance (whole task)
- Only invited or bootstrap emails can get an account; B cannot read/change/delete A's data (verified rows); every admin action audited.
