# TASK-007 — Post generation core (text)
Depends on: TASK-005c; owner `ANTHROPIC_API_KEY` in GitHub env `dev` (set 2026-10-06)
Read first: docs/01-PRODUCT-SPEC.md §4.2, §7; docs/02-ARCHITECTURE.md §5–6; ADR-010, ADR-015, ADR-022, ADR-035, ADR-036

## Goal
A member asks for a post on a brand channel and gets a rule-checked, ready-to-copy text built from the brand's CGP and materials.

## Scope
- Tables `model_registry` (seeded), `posts`, `usage_ledger`; LLM adapter (Anthropic SDK, forced tool, prompt caching); cost math; race-free spend cap (reservations).
- `generatePost` with one automatic fix round; `editPost` (re-check), `setPostStatus`, `listPosts`, `getPost`, `postCost`.
- UI: "Objave" section on the brand page, post page with editor, live counters, status buttons, cost.
- Deploy config: `ANTHROPIC_API_KEY` secret.

## Out of scope
Images, carousels, ads, plan import, no-repeat embeddings, PDF/Office material extraction, background worker.

## Tests
Unit (prompt, cost, compose/check), integration with a fake LLM (all outcomes, cap boundaries and parallelism, tenancy), E2E against a local Anthropic stand-in.

## Acceptance
On dev the owner generates an Instagram post for a brand with a CGP: status "pripravljena"/"za pregled", rule failures listed in plain Slovenian, cost shown.
