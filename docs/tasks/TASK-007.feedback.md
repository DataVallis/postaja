# TASK-007 feedback
Status: **DONE** (PR to dev) — owner's first real generation on dev pending.

## What I implemented
- Schema + migrations `0008_generation` (model_registry, posts, usage_ledger) and `0009_seed_model_registry` (Sonnet 5.5 default, Haiku 4.5, Opus 5.5; prices from platform.claude.com pricing, checked 2026-10-06).
- `src/server/llm/`: adapter types, Anthropic client (forced tool, cached brand block, errors without request bodies), cost math, spend reservations, fake client for tests.
- `src/server/posts/`: prompt builder, generation with one fix round, edit/status/list/cost.
- UI: brand page "Objave" (first section), `/app/posts/[id]` editor with live counters (shared rule engine in the browser), copy, statuses, cost.
- `ANTHROPIC_API_KEY` wired into deploy config/workflow/Kamal secrets; `.env.example`; cheat sheet.
- E2E Anthropic stand-in (`tests/e2e/mock-anthropic.mjs`) via the SDK's `ANTHROPIC_BASE_URL`.

## Deviations
- Generation runs in the request, not in a pg-boss worker (ADR-036) — the worker comes with image jobs.
- Materials: only TXT/MD/CSV go into the prompt; PDF/Office extraction is a follow-up task.
- No no-repeat check yet (needs embeddings, ADR-008 open).

## New dependencies
- `@anthropic-ai/sdk@0.131.0` — official Claude API client (ADR-010).

## Test results (real outputs, this session)
```
2026-10-06T07:29:12+02:00
$ pnpm lint
lint problems: 0
$ pnpm typecheck
typecheck: ok
$ pnpm test
 Test Files  11 passed (11)
      Tests  104 passed (104)
$ pnpm test:int
 Test Files  10 passed (10)
      Tests  132 passed (132)
$ pnpm build
build exit 0 (run at 07:28 above, unchanged since)
$ pnpm test:e2e
  5 skipped
  27 passed (40.0s)
```

## Deliberate breaks (2026-10-06T07:30–07:31)
```
## Break A: no row lock on the spend check
     × parallel reservations cannot jointly exceed the cap (row lock): of 5 × 3000 under a 10000 cap exactly 3 pass
      Tests  1 failed | 15 passed (16)
## Break B: cap refuses used + estimate = cap
     × exact boundary: used + estimate = cap passes, one more is refused; last month does not count
      Tests  1 failed | 15 passed (16)
## Break C: no automatic fix round
     × rule failure → one automatic fix with the violations → ready (2 calls, 2 ledger rows)
     × still failing after the fix → needs_review with the failures shown
      Tests  2 failed | 14 passed (16)
## Break D: materials of every org (unscoped query)
     × text materials of this brand are in the prompt; PDFs, other brands and other orgs are not
      Tests  1 failed | 15 passed (16)
## Break E: material tags not neutralised
     × materials cannot break out of their block (prompt-injection guard)
      Tests  1 failed | 8 passed (9)
## Break F: provider failure keeps the reservation
     × schema-invalid answer twice → failed INVALID_OUTPUT; provider error → failed, reservation released
      Tests  1 failed | 15 passed (16)
## Restored
      Tests  16 passed (16)
      Tests  9 passed (9)
```

## NOT RUN
- A real Claude call — the sandbox has no key and must not have one. First real call = owner's check on dev.

## Open questions / risks
- In-request generation holds a server action for up to ~20 s (×2 with a fix round); fine for one owner, revisit with the worker.
- Prices are data; when Anthropic changes them, the super admin must update `model_registry` (no UI yet — like TASK-004b for platform rules).

## Docs updated
ADR-036; docs/technical/posts.md (+ maintenance map); CHEATSHEET; tasks README; this spec + feedback; HANDOFF; `.env.example`.
