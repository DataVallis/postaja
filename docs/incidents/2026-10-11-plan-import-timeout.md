# 2026-10-11 — Plan import times out (504) for a long Markdown plan

**Impact:** dev, owner uploading `plan-objav-60-dni-…md` (~27–32k characters each) for petprep.si in "Uvoz planov":
the button spun, then "Nalaganje ni uspelo. Poskusi znova."; the browser showed `POST /api/imports` → 504 Gateway
Timeout. Nothing was stored.

**Cause:** `startImport` called Claude inside the upload request to list every post of the document verbatim. For a
60-day plan that is one answer of many thousand tokens — minutes of generation — while the proxies in front of the app
wait far less (route `maxDuration` 120 s, nginx `proxy_read_timeout` 120 s, kamal-proxy's own response timeout). A
single answer for such a plan could also come close to the 16k output-token limit.

**Fix (ADR-078):** the request only checks, parses and stores the file; the AI reads it in the background (`plan-read`
queue, status `reading` → `draft` / `failed` with the reason). The review page shows "Berem plan …" and refreshes
itself. Documents over 12k characters are split at headings and read 3 parts at a time, answers joined in order.

**Proof:** integration tests (upload returns with no AI call and a queued job; a 40-post Markdown plan read in parts,
order and platform kept, one settled ledger row per call; provider error kept as `AI_FAILED:PROVIDER`, failed import
can be discarded, not confirmed), unit tests for the splitting, E2E plan import / plan / bulk / images with the worker.
