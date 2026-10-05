# Super admin (`/admin`)

Status: **Built** (TASK-003c).

## Access
- Only users with `user.role = superadmin` (bootstrap: `SUPERADMIN_EMAILS`, ADR-028).
- Everyone else — signed in or not — gets **404**, so the area is not discoverable.
- The guard `requireSuperadmin()` (`src/server/admin/guard.ts`) runs in the admin layout, in every admin page **and in every server action** (actions are callable without the page).
- Services (`src/server/orgs/service.ts`) check the actor role again — defence in depth.

## Pages
| Path | What |
|---|---|
| `/admin` | organizations: plan, status, members, pending invites, monthly cap |
| `/admin/orgs/new` | create: name, slug, owner email, plan, cap (USD) |
| `/admin/orgs/[id]` | settings (plan, status, cap), members + pending invitations, invite owner/editor |
| `/admin/audit` | last 100 audit rows, newest first |

## Audit log (`audit_log`)
One row per super-admin action, written **in the same transaction** as the change, so a failed or refused change leaves no row.
Actions today: `org.create`, `org.settings.update` (meta = `{field: {from, to}}`), `member.add`, `member.invite`.
bigint values are stored as strings in `meta`.

## Money input
The cap is typed in USD and converted with `usdToMicro` (`src/lib/money/usd.ts`): string/integer math only, max 6 decimals, max 1,000,000 USD; shown with `microToUsd` (2 decimals, half-up).

## Request context fallback
If a session has no active organization (e.g. you were added to an org after signing in), `/app` uses your first membership — still verified by `resolveOrgContext`.

## Tests
- Integration `src/server/admin/admin.int.test.ts`: one audit row per action, from→to meta, refused/failed actions leave no row, inviteMember (existing user → member, role update, re-invite cancels previous), list/detail/audit queries.
- Unit `src/lib/money/usd.test.ts`: conversion boundaries.
- E2E `tests/e2e/admin.spec.ts`: full flow (create comped org with 12.5 USD cap, invalid amount error, invite editor, audit visible, `/app` shows org, invitee joins as editor and gets 404 on `/admin`), anonymous 404, axe on every admin page.
- E2E uses a second super admin (`e2e-root@example.test`) and `AUTH_MAGIC_LINK_RATE_MAX=1000`; servers keep 5/min (tested).
