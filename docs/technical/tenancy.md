# Organizations and tenancy

Status: **Live on dev** (TASK-003b, PR #7).

## Model
| Table | Notes |
|---|---|
| `organization` | Better Auth plugin; `id` text, unique `slug` |
| `member` | `(organization_id, user_id)` unique; `role` = `owner` \| `editor` |
| `invitation` | email (lower-case), role, `status` pending/accepted/canceled/rejected, `expires_at` (7 days), `inviter_id` |
| `org_settings` | 1:1 with organization: `plan` (trial/starter/pro/comped), `status` (active/suspended), `spend_cap_micro_usd` (bigint, default 50 USD), `limits`, `repeat_thresholds` — CHECK constraints on plan/status/cap |
| `session.active_organization_id` | the org the user works in; never trusted without re-check |

## Flows
- **Create organization** (super admin only, `createOrganization`): org + settings in one transaction. Owner email with an account → member immediately; otherwise an owner invitation is stored and emailed.
- **Invite** (owner only): Better Auth `createInvitation` → our invitation mail. Editors are refused by access control.
- **Join**: an invited email may sign up (`canSignUp`); at every sign-in pending, unexpired invitations are accepted (idempotent) and the first membership becomes the active org.
- **Plan/status/cap** (super admin only, `updateOrgSettings`, strict schema).

## Request context
`getRequestContext()` → `resolveOrgContext(db, session)`: requires an active org, a `member` row for this user in that org, and `org_settings.status = active`. Errors: `NO_ACTIVE_ORG`, `NOT_A_MEMBER`, `ORG_SUSPENDED`, `ORG_NOT_FOUND`.

## Scoped data access — `forOrg(db, ctx)`
`select / insert / update / delete` on any table with `orgId` (ours) or `organizationId` (Better Auth). Every filter includes the org id; inserts force it; updates strip any attempt to change it.
**Feature code must not query tenant tables without `forOrg`.**

## Cross-tenant tests (mandatory for every tenant resource)
`tests/tenancy/harness.ts` → `crossTenantSuite({ name, scopes, seedInA, read, update, remove, raw })` generates three tests: B cannot read, update (0 rows, raw row unchanged) or delete (row still exists) A's row. Used today for `org_settings` and `invitation`; every new tenant table (brands, posts, …) adds one call.

## Team (TASK-028, ADR-058)
`src/server/orgs/team.ts`, page `src/app/app/team/**`. Owners: `inviteToTeam` (pending invitation + mail; members
limit counts members + pending invitations; settings row locked), `cancelInvitation`, `setMemberRole`, `removeMember`
(both keep at least one owner; member and owner rows locked). Every change writes `audit_log` (`team.*`) with the owner
as actor. Invitations are accepted on sign-in (`acceptPendingInvitations`). `orgUsage` gives plan, limits and this
month's use for the page. Tests: `src/server/orgs/team.int.test.ts`, `tests/e2e/team.spec.ts`.

## Plan limits
`org_settings.limits` `{ brands?, members?, generationsPerMonth? }`, edited in /admin (empty = unlimited, audited).
Brands: `assertBrandRoom` in `createBrand` and on un-archive. Generations: `reserve()` in `src/server/llm/spend.ts`
counts this month's ledger rows under the settings lock and throws `GenerationLimitError` (a `SpendCapError`).
