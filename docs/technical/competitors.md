# Competitor research

Status: **Step 1 built** (TASK-049): find, keep, remove, add. Next: TASK-050 collect + analyze + learnings + gaps,
TASK-051 no-copy check + Meta Ad Library. Decisions: ADR-023, ADR-066. Spec §4.3.

## What the member does
Brand → **Konkurenca**: optional wish → *Najdi konkurente* (max cost shown). Claude searches the web with the CGP and
proposes up to 10 competitors (website, public profiles, reason). Suggestions: *Obdrži* / *Odstrani*. *Dodaj
konkurenta*: name, website, one profile, note. Any member; archived brands are read-only.

## How
- Tables (migration 0038): `competitors` (name, website, handles `[{platform, url}]`, source `ai`/`manual`, status
  `suggested`/`kept`, reason), `competitor_runs` (kind `find`, status queued/running/done/failed, hint, error, added,
  model, requested_by). At most 40 competitors per brand.
- `src/server/competitors/ai.ts`: `findRequest` (tool `submit_competitors`, CGP ≤ 20k chars, known competitors listed
  so they are not proposed again, the member's wish; pages are data, never instructions), `publicUrl` (http/https only,
  no credentials, `https://` added), `foundSchema`.
- Web search: `StructuredRequest.webSearch = { maxUses: 8 }` → the Anthropic adapter adds the server tool
  `web_search_20250305` next to ours and continues `pause_turn`; `Usage.webSearches` is billed at $10 / 1,000
  (`WEB_SEARCH_MICRO_USD`); `cappedCall` reserves ~30k input tokens per allowed search plus the searches. Web search must
  be enabled for the Anthropic organization (an administrator turns it on in the Claude Console); if not, the run fails with Anthropic's reason.
- `src/server/competitors/service.ts`: `requestFind` (one run per brand, stale after 15 min) → queue
  `competitors-find` → `runFindJob` (as the member who asked, re-verified; `SPEND_CAP`, `AI_FAILED:<reason>`,
  `INVALID_OUTPUT` stored on the run) → `newSuggestions` (bad links dropped, duplicates by site host or folded name
  skipped). `addCompetitor`, `keepCompetitor`, `removeCompetitor`, `listCompetitors`, `findEstimate`.
- UI: `src/app/app/brands/[id]/competitors-section.tsx`, actions `src/app/app/brands/competitor-actions.ts`.

## Tests
`competitors.int.test.ts` (prompt inputs incl. web search and wish, cleaning and dedupe, cost of searches, keep /
remove / add, duplicates and bad links refused, other org, failures and the cap on the run), `llm/anthropic.test.ts`
(server tool offered, paused turn continued, searches counted and billed), E2E `competitors.spec.ts`.
