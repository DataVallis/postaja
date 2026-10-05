# TASK-004b feedback
Status: **DONE** (PR to dev).

## What I implemented
- Service `src/server/rules/admin.ts`: `updatePlatformRule`, `updateFormatPreset` (super admin only, validation, `SELECT … FOR UPDATE`, audit `platform_rule.update` / `format_preset.update` with `{field: {from, to}}`, no write when nothing changed).
- `src/server/rules/verification.ts`: 90-day re-verification rule; `countDueForReverification`, `getPlatformRuleRow`, `getPresetRow` in `repo.ts`.
- UI: edit pages for rules and presets (server actions + client forms), row links and "preveri" badges on `/admin/platform`, reminder banner on `/admin` and `/admin/platform`. sl + en strings.

## Found by tests
- jsonb returns object keys in its own order, so an unchanged safe zone looked "changed" (spurious audit row on every save). Comparison now uses key-sorted JSON; regression test added.
- The first concurrency test (2 writers) passed even without the row lock. Replaced with 10 writers + audit chain check, which fails without the lock (Break B).

## Deviations
- Reminder is in-app only (banner + badge), no email — there is no scheduler yet (ADR-032).
- No create/delete of presets from the UI; disable instead (ADR-032).

## New dependencies
None.

## Test results (real outputs, this session)
```
2026-10-05T20:18:38+02:00
$ pnpm lint
lint problems: 0
$ pnpm typecheck
typecheck: ok
$ pnpm test
 Test Files  9 passed (9)
      Tests  75 passed (75)
$ pnpm test:int
 Test Files  7 passed (7)
      Tests  83 passed (83)
$ pnpm build
build exit 0 (routes /admin/platform/presets/[key], /admin/platform/rules/[platform])
$ pnpm test:e2e   (2026-10-05T20:15:34+02:00)
  3 skipped
  23 passed (41.8s)
```

## Deliberate breaks (2026-10-05T20:16–20:17)
```
## Break A: updatePlatformRule without the super-admin check
     × a non-super-admin is refused and nothing changes
      Tests  1 failed | 11 passed (12)
## Break B: no row lock (10 concurrent writers)
     × concurrent edits serialize: every audit row's 'from' is the previous row's 'to' (no lost update in the log)
      Tests  1 failed | 11 passed (12)   (twice in a row)
## Break C: unsorted JSON comparison
     × changes size and safe zone, audits JSON diff; disabling makes it untargetable
     × saving an unchanged preset writes nothing even though jsonb reorders safe-zone keys (regression)
      Tests  2 failed | 10 passed (12)
## Break D: visibleChars may exceed captionMax
     × refuses impossible combinations: …
      Tests  1 failed | 11 passed (12)
## Break E: due threshold > instead of >=
     × exact boundary: 89 days fine, 90 and 91 due
      Tests  1 failed | 4 passed (5)
## Restored
      Tests  12 passed (12)  (3 runs)
      Tests  5 passed (5)
```

## NOT RUN
- Smoke on dev after deploy — the sandbox cannot reach dev-postaja.inzenirji.si (proxy allowlist); verified via the Deploy run instead.

## Docs updated
ADR-032; docs/technical/rules.md, docs/technical/admin.md; tasks/README.md; this spec + feedback; HANDOFF.
