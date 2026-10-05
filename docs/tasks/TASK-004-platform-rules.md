# TASK-004 — Platform rules, format presets, rule engine
Depends on: TASK-003
Read first: docs/01-PRODUCT-SPEC.md §4.2, §5.9; ADR-020, ADR-022, ADR-030

## Goal
Every later generation and the editor check text and assets against one shared, tested rule engine fed by sourced platform data.

## Scope
- Tables `platform_rules`, `format_presets` (+ CHECKs), idempotent seed with source/confidence/verified date; stricter value on conflicts.
- `src/lib/rules`: counting (graphemes, X weighted), extractors, `effectiveRules`, `checkText/Thread/Carousel/Asset`, safe area.
- `src/server/rules/repo.ts`; read-only `/admin/platform`.

## Tests
Exact boundaries (limit, ±1) for captions, hashtags, thread parts, slides, pixels, bytes, durations, safe area; diacritics/emoji/URLs; seed idempotency without overwriting edits.

## Acceptance
All checks green; `/admin/platform` lists every rule and preset with source and date.
