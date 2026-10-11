# Plan import

Status: **Built** (TASK-012). Decisions: ADR-041, ADR-078 (reading in the background).

The owner's content plans come in many shapes (see the four examples from 2026-10-06): an X-only sheet without a
platform column (CHERR.IO), a 30-day sheet over three accounts with dates, times, formats and slide texts (AI
Builders), a 100-day Instagram sheet with relative days "+12" (inzenirji.si), and a Word document with "Post N"
sections and one shared image style (LinkedIn). Postaja reads any of them into planned posts.

## Flow
1. `/app/import` — drop one file (XLSX, CSV/TSV, DOCX, PDF, MD, TXT; ≤ 20 MB) → `POST /api/imports`
   (`src/server/plans/http.ts`: same-origin, signed in, size from the header) → `startImport`.
   **The request only checks and stores the file** (type, size, sheets parsed / document text read — errors such as
   `UNSUPPORTED_TYPE`, `NO_POSTS` for an empty document answer at once) and creates the import with status `reading`;
   the AI part runs in the worker (`plan-read` queue, `runReadJob`, no retry, 10 min expiry) → `draft`, or `failed`
   with `error` (`AI_FAILED:PROVIDER`, `SPEND_CAP`, …). The review page shows "Berem plan …" and refreshes every 2 s;
   an import still `reading` after 15 min is shown as failed (`TIMEOUT`). Without a queue (tests, scripts)
   `startImport` reads inline and AI errors throw (ADR-078).
2. **Tables** (`table.ts`): every sheet → header (first row with ≥ 2 cells among the first 20) + rows (cells at their
   real column, from the cell reference). **The AI only names the columns** (`map_plan_columns`, ≤ 1,500 tokens, header
   + 6 sample rows); `guessMapping` (header words checked against sample values) is the fallback and the starting
   point. No platform column → the file/sheet name may say it (`platformFromName`: "…_X_posts" → X).
   **Documents**: text via `materialText` (≤ 80k characters); a text over 12k characters is split at Markdown headings
   (a heading stays with its post; a longer section at blank lines, `splitDocument`) and the parts are read 3 at a time,
   answers joined in document order with the first shared image style / platform any part found; the AI lists the posts (`extract_plan_posts`), and every text is checked
   against the document (whitespace-normalised) — a reworded text gets the `TEXT_CHANGED` warning. A shared image style
   is prepended to each image prompt.
3. Every value is read by code (`mapping.ts`, verbatim): dates (Excel serials, ISO, d.m.yyyy), times (also Excel
   fractions), "+N" / day numbers, platforms, formats ("Carousel (6)", "Thread (9)", "Text + image", "Video …"),
   slides ("1: …\n2: …", "a | b"), numbered threads ("1/ …"), statuses (Objavljeno/posted/published → history;
   preskočeno/skip → not imported), hashtags from a hashtags or mixed "CTA / hashtags" column. Unknown values become
   warnings, never guesses.
4. Review `/app/import/[id]`: counts, **which channel each platform/account goes to** (`suggestChannel`, same
   platform only: the account matches a channel's handle or a word of its brand's name; else, if the file name names one
   brand (`brandFromName`), only that brand's channel — none means no suggestion and a link to add the channel; otherwise
   **nothing**, not even in a one-brand org (owner 2026-10-07: a CHERR.IO plan was offered AI Builders' X channel);
   "Ne uvozi" skips a group). **"Za kateri brand je plan"** (`setImportBrand`, settings.brandId): pick a brand, or
   "+ Nov brand" with the name read from the file (`brandNameFromFile`: "CHERR.IO X posts 001 (1)" → "CHERR.IO") and a
   language; the brand (owner only; reused if the name exists) and missing channels per platform (handle from the form,
   default the plan's account) are created there. Choosing resets earlier channel choices; suggestions then come only
   from that brand's channels,
   start day for relative plans, start + gap for undated items, editable column meanings ("Preberi znova").
5. `confirmImport` (row-locked, a double click imports once): per item a post on the chosen channel with
   `format`, `scheduled_on`/`scheduled_time`, `plan` (topic, category, audience, account, CTA, link, first comment,
   image prompt, overlay text, slides, notes, source "Sheet!row") and `import_id`. Text → verbatim caption (+ plan
   hashtags not yet in it), rule-checked → `ready` / `needs_review`; no text → `planned`; published → `published` with
   `published_at`. **Duplicates** are skipped: same channel + same text, or for posts from a plan same channel + day +
   topic (so a planned post written or edited by hand since is not created again).

## Data
`plan_imports` (org, file in S3 at `org/<org>/imports/<id>.<ext>`, kind, status draft/imported/discarded, parsed
tables, mappings, AI items, settings, reader, created count). `posts` gained `format`, `scheduled_on`,
`scheduled_time`, `plan`, `import_id`, `published_at` and the status `planned` (migration 0013).

AI calls go through the org's spend cap (reserve → settle/release, ADR-036). Any member may import (like generating).

## UI
Sidebar "Uvoz planov". `/app/posts?import=<id>` lists one import in plan order (day, time) with "Termin" and "Format"
columns; the post page shows "Iz plana" (slot, format, slides, prompt, overlay text, CTA, first comment, source). A
planned post without text can be written by hand (→ ready/needs review); "Vrni v plan" returns a skipped one.

## Tests
`mapping.test.ts` (value readers, the owner's three sheet shapes by headers, file-name platform), `plans.int.test.ts`
(AI and header readers, provider failure fallback, documents with TEXT_CHANGED, review choices, verbatim posts, rule
check, history, duplicates incl. hand-edited posts — deliberate break fails it, double confirm, tenancy, editor),
`tests/e2e/plan-import.spec.ts` (Excel over three accounts, channel choice, plan order, carousel slides, hand-written
planned post, re-import without duplicates, Word plan with start + gap; axe).
