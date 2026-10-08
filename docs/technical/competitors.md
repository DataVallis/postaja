# Competitor research

Status: **Steps 1–2 built** (TASK-049 find, keep, remove, add; TASK-050 collect, analyze, learnings, gaps). Next:
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

## Step 2: collect and analyze (TASK-050)
- Screenshots: `POST /api/competitors/[id]/screenshots` (any member, same origin, ≤ 10 MB, PNG/JPG/WebP re-encoded,
  ≤ 20 per competitor) → `competitor_items` kind `upload`, S3 `org/<org>/competitors/<competitor>/<id>.<ext>`; shown
  via `/api/competitor-items/[id]` (302 presigned); `deleteScreenshot` on purpose.
- *Analiziraj konkurente*: `requestAnalyze` (≥ 1 kept, one run per brand shared with "find") → queue
  `competitors-analyze` → `runAnalyzeJob`: per kept competitor (≤ 15) the website is fetched with `fetchPublicFile`
  (SSRF guard, ≤ 3 MB, 15 s) and read by `html.ts` `htmlToText` (title, meta description, visible text; no scripts,
  styles, nav, footer, forms); the outcome replaces the competitor's `web_page` item (text ≤ 20k or an error code
  `BLOCKED`/`HTTP`/`TIMEOUT`/`NETWORK`/`TOO_LARGE`/`NOT_HTML`/`NO_TEXT`). Screenshots: newest 3 per competitor, ≤ 12,
  downscaled to 1024 px JPEG. Claude gets the CGP, the brand's 40 latest topics, ≤ 6k chars per page and the pictures
  (tool `submit_competitor_report`: summary, profiles, adopt / reject with evidence, gaps); pages and pictures are data.
- `competitor_reports` (every report stays): summary, profiles, learnings `{id, kind, title, why, evidence, decision}`,
  gaps, draft_id. `decideLearning` (any member: yes / no / undecided). `sendLearningsToCgp` (owner): current CGP +
  "## Iz analize konkurence (date)" with the accepted items → pending `cgp_drafts` row, source `competitors`
  (replaces an earlier pending draft); the active CGP changes only when the owner saves a version (ADR-035/038).
- Gaps link to the posts tab with `?ideaHint=<topic>#ideas`, which pre-fills the ideas wish.
- UI: `competitors-section.tsx` (collected per competitor, analysis card), `competitor-report.tsx`,
  `competitor-uploads.tsx`; migration 0039.

## Tests
`competitors.int.test.ts` (prompt inputs incl. web search and wish, cleaning and dedupe, cost of searches, keep /
remove / add, duplicates and bad links refused, other org, failures and the cap on the run; screenshots, page reading
with a blocked site, prompt inputs incl. pictures, report, decisions, owner-only CGP draft, reports kept), `html.test.ts`, `llm/anthropic.test.ts`
(server tool offered, paused turn continued, searches counted and billed), E2E `competitors.spec.ts` (find → keep → add → screenshot → analyse → tick → CGP draft inserted → gap opens ideas).
