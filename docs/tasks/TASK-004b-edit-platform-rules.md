# TASK-004b — Super admin edits platform rules and presets + quarterly re-verification
Depends on: TASK-004
Read first: docs/01-PRODUCT-SPEC.md §4.2, §5.9, §11; ADR-020, ADR-022, ADR-030; docs/technical/rules.md, docs/technical/admin.md

## Goal
The super admin keeps platform limits and format presets current from `/admin`, every change is audited, and stale data is flagged.

## Scope
- `src/server/rules/admin.ts`: `updatePlatformRule`, `updateFormatPreset` — super admin only, zod-validated, row lock, one audit row with from → to per changed field; unchanged save writes nothing.
- Preset key/platform/placement/media are fixed; presets are disabled, never deleted; no creation from the UI.
- Edit pages `/admin/platform/rules/[platform]`, `/admin/platform/presets/[key]`; links from `/admin/platform`.
- Re-verification: due when `verified_at` ≥ 90 days old; banner on `/admin` and `/admin/platform`, badge per row.

## Tests
Unit: 89/90/91-day boundary. Integration: engine sees edits, audit diff, refused/invalid writes nothing, boundaries, concurrency, disabled preset untargetable, due count. E2E: edit + invalid + unchanged + audit + preset disable/enable, axe.

## Acceptance
All checks green; editing visible in `/admin/audit`; ADR-032 written.
