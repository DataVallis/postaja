# Bulk creation and background jobs

Status: **Built** (TASK-014). Decisions: ADR-007 (pg-boss), ADR-042 (worker in the web container on dev).

## What the owner does
- **Plan → Dan**: "Ustvari besedila (N)" writes every post of that day without text — all brands, or the brand in the
  filter. **Brand → Objave**: "Ustvari besedila" for the next 7 / 30 days / all planned. **A planned post**: "Napiši
  besedilo z AI" (now, in the request). A failed post without text is retried in place ("Poskusi znova").
- **Plan → Ustvarjanje**: runs with a progress bar (written / total, failed, skipped), status, "Ustavi". The page
  refreshes itself every 3 s while a run works; the run continues if the page is closed.

## How
- `src/server/bulk/service.ts`: `bulkCandidates` (planned or failed, no text, has a channel, live brand, this org,
  slot order; ≤ 200 per run) → `startBulk` (run + one item per post in one transaction, then one pg-boss job per item,
  singleton key `post:<id>:text`) → worker `runBulkItem` (claims the item; re-verifies the creator's membership and the
  org; `generateForPost`; item done / skipped `HAS_TEXT` / failed with the post's error, e.g. `SPEND_CAP`,
  `NO_ACCESS`; the run is `done` when no item is queued or running). `cancelBulk` skips queued items.
- `generateForPost` (`src/server/posts/generate.ts`) writes an existing planned post: it **claims the row**
  (planned/failed and no text → generating) before calling the model, so retries, parallel runs or a click on
  "Napiši besedilo" never write a post twice. The request is `planBrief`: topic, format and slide count, pillar,
  audience, overlay text, slide texts, CTA, link, first comment (not repeated), image (context only), notes — the
  plan's own words. The same writing loop as single posts (spend cap reservation, one fix round, rule check).
- `src/server/jobs/boss.ts`: one pg-boss per process (schema `pgboss`, created by pg-boss), queue `post-text`
  (1 retry after an unexpected error, 5 min expiry). `src/server/jobs/worker.ts`: 2 posts at a time per process.
  Workers start from `instrumentation-node.ts` when `RUN_WORKER=1` (dev: in the web container; E2E server too).
  Moving them to a separate Kamal role later = `RUN_WORKER=1` on that role, unset on web.
- Tables `bulk_runs`, `bulk_items` (migration 0014).

## Tests
`src/server/bulk/bulk.int.test.ts`: candidates (day across brands, slot order, failed included, text/other org/
other day/no channel/archived excluded), range scope, nothing to do, too many, one job per post with keys, posts
written from the plan, duplicate job and second run do not rewrite, **two runs racing write each post once**
(deliberate break: without the claim it fails), spend cap, cancel, creator removed → `NO_ACCESS`, other org cannot
cancel or list, `planBrief`, and the real pg-boss path end to end. E2E `tests/e2e/bulk.spec.ts`: day run across two
brands with live progress, brand run, single post.
