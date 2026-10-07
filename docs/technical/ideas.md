# AI post ideas and no-repeat memory

Status: **Built** (TASK-019). Decisions: ADR-048 (lexical no-repeat until an embedding provider, ADR-008).

## What the owner does
Brand → **Objave** → *Predlagaj ideje*: channel, how many (1–30), from which day, an optional wish ("ta teden o cenah").
Claude proposes the ideas; the review page (`/app/ideas/[id]`) lists title, angle, format, pillar, the proposed day and
a "Podobno (NN %) objavi …" note with a link when an idea is close to an earlier post (those start unticked). Tick,
change days, *Dodaj označene v plan* → planned posts (`plan.topic`, `plan.notes` = angle, `plan.category` = pillar),
written later by Postaja like any plan (single, bulk, "Ustvari ves plan"). *Zavrzi* discards the run.

## How
- `src/server/ideas/ai.ts`: prompt + tool `suggest_post_ideas` (zod schema → JSON schema; pillars and formats as enums).
  Inputs: CGP (≤ 20k chars), pillars with target share and how many recent posts each has, the brand's last 60 topics,
  platform, post language (`postLanguage`), the channel's formats (types → text/thread/image/carousel), the wish, and in
  later rounds the rejected and already kept titles.
- `src/server/ideas/service.ts`: `suggestIdeas` (any member; cost-capped via `cappedCall`, brand's Claude model) —
  memory = the brand's posts of the last 180 days (created or slotted), all statuses except skipped/failed, as
  `topic_summary` → `plan.topic` → brief. Each idea is compared with the memory and with ideas already kept:
  ≥ `REPEAT_BLOCK` (0.6) → rejected and asked again (≤ 3 calls in all); ≥ `REPEAT_WARN` (0.4) → kept with the note.
  Slots: `freeSlots` — the channel goal's weekdays and posts per day from the start day, minus non-skipped posts
  already there (≤ 180 days ahead; no goal → every day). `acceptIdeas` locks the run row (`FOR UPDATE`), must be a
  draft, creates the posts in one transaction. Table `idea_runs` (migration 0020).
- `src/server/ideas/similar.ts`: TF-IDF cosine over folded stems (first 5 letters, diacritics folded, stop words out).

## Tests
`similar.test.ts` (stems, repeat / warn / pass cases), `ideas.int.test.ts` (prompt inputs incl. pillar counts and
skipped posts left out, replacement round with the rejected list, slots around a taken day, cost ledger, similar note,
twin ideas, refusals: other org, other channel, too many, provider error, all repeats, spend cap; accepting with
changed days, once only incl. two clicks at once, other org, bad index, discard), `freeSlots`. E2E `ideas.spec.ts`.
