# Posts (text generation)

Status: **Built** (TASK-007). Decisions: ADR-010, ADR-015, ADR-022, ADR-035, ADR-036.

## Flow (`src/server/posts/generate.ts` → `generatePost`)
1. Any member (owner or editor) sends brand + channel + brief (3–2000 chars). Brand/channel found via `forOrg` (other org → `NOT_FOUND`), brand not archived.
2. Effective rules = platform (`platform_rules`) ⊕ channel rules ⊕ brand profile rules, most strict wins (`effectiveRules`).
3. Materials (TASK-009, ADR-039) — `materialsFor`: text of every extracted source of the brand (PDF, DOCX, XLSX, PPTX, TXT/MD/CSV; read at upload, older rows read here first via `extractPendingSources`). All of it when ≤ 60,000 characters; otherwise `selectMaterials` (`retrieve.ts`) ranks ~1,500-character paragraph chunks by BM25 against the brief (file name counts, diacritics folded, SL/EN stop words), keeps the best within budget, ties → newer file / earlier passage, and marks left-out text with `[…]`.
4. A `posts` row is created (`generating`) with the current `profile_version_id`.
5. Prompt (`prompt.ts`, version `post-text-v1`): system = base instructions · **brand block (cached)** with `<cgp>`, pillars and `<materials>` (quoted; `<material>`/`<cgp>` tags inside sources are replaced by `[tag removed]`) · channel block with language and the exact hard limits; user = the brief.
6. Spend: `reserve()` (worst case, row lock on `org_settings`) → Claude call (forced `submit_post` tool, `max_tokens` 2000) → `settle()` with the real usage, or `release()` on a provider error.
7. Output validated by zod (caption or thread `parts`, hashtags, topic summary). Hashtags normalised and appended (to the last part on X). `checkPost` = `checkText` (or `checkThread` + content rules for X).
8. Violations → one fix round with the violations listed; still failing → `needs_review` with `rule_failures`. Invalid JSON twice → `failed INVALID_OUTPUT`; provider error → `failed PROVIDER` / `NOT_CONFIGURED`; cap → `failed SPEND_CAP` (model never called).

## Editing and statuses
- `editPost` (any member, statuses ready / needs_review / approved): text re-checked with the same rules → ready or needs_review.
- `setPostStatus`: ready|needs_review → approved|skipped · approved → published|skipped|ready · published → approved · skipped → ready · failed → skipped. Approving a post with failures is the explicit override.

## Money
- `model_registry` (global): prices in micro-USD per million tokens (input, output, 5-min cache write, cache read), one default per kind; seed in `drizzle/0009_seed_model_registry.sql` (`ON CONFLICT DO NOTHING`).
- `usage_ledger`: one row per call, `reserved` → `settled`; month-to-date = sum of the UTC calendar month incl. reservations. Cost = Σ ceil(tokens × price / 10⁶) (`src/server/llm/cost.ts`).

## UI
- Brand page, first section **Objave**: channel + "Kaj objavimo?" → "Ustvari objavo" (pending state) → `/app/posts/<id>`; last 10 posts with status.
- Post page: status, brief, rule failures in plain language, editor (caption or thread parts) with live counters from the shared rule engine, Copy, Save, status buttons, model and cost.

## Env
`ANTHROPIC_API_KEY` (secret: GitHub env `dev` → deploy workflow → `.kamal/secrets.dev` → `config/deploy.dev.yml`). Without it generation ends `failed NOT_CONFIGURED`. Tests never need it.

## Tests
- Unit `src/server/posts/retrieve.test.ts`: terms (diacritics, stop words), chunking, all-when-fits, matching passage wins, file name counts, no-match fallback, never over budget. `src/server/files/material-text.test.ts`: XLSX (sheet order by relationships, shared rich text, inline strings, numbers/booleans, row cap), PPTX (slide order, runs), every kind, refusals, 300k cap.
- Unit `src/server/posts/prompt.test.ts`: cost rounding, worst case, prompt layout/caching, injection guard, material budget, limits text, thread vs caption schema, fix-round text, hashtag normalisation, checkPost incl. X 280/281.
- Integration `src/server/posts/generate.int.test.ts` (real Postgres + S3 stand-in, fake LLM `src/server/llm/fake.ts`): ready path with exact cost, fix round, needs_review, invalid output, provider error releases the reservation, X thread, knowledge base (PDF/DOCX/XLSX/PPTX/CSV in; image, unreadable PDF, other brand/org out), lazy read of pre-TASK-009 sources (and not by another org), over-budget selection by brief, editor allowed / other org / archived / bad brief, cap refusal without a call, cap boundary (= passes, +1 refused, last month ignored), 5 parallel reservations vs cap, edit re-check, transitions, cross-tenant harness for `posts`.
- E2E `tests/e2e/posts.spec.ts` with `tests/e2e/mock-anthropic.mjs` (started by Playwright, reached via `ANTHROPIC_BASE_URL`).
