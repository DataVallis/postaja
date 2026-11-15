# TASK-062 feedback — part 1 (pilot fixes)
Status: PARTIAL (pilot fixed; re-run after deploy and the full round follow)

## What I implemented
Four image fixes from the pilot (ADR-096), see the task file for the defects.

## Files changed (path — why)
- `src/server/design/render.ts` — `fontMeasure`, `keepShortWords`, `fitText` (real widths, shrink below the minimum), `pickLogo`, `colourUnder`, `logos` in `RenderInput`.
- `src/server/design/service.ts` — `brandAssetBytes` returns `logos`; previews take them.
- `src/server/images/service.ts` — `compositionHint`, `illustrationPrompt(…, template)`, every illustration checked at up to 1568 px, second check, `ABSTRACT_ONLY`.
- `src/server/{ads/creatives.ts,video/reel.ts,video/service.ts}` — pass `logos`; ads get the composition hint.
- Tests: `design.test.ts` (fitting), `logo-pick.test.ts`, `images/composition.test.ts`, `design.int.test.ts` (check on every picture, abstract last try), `ads.int.test.ts` (checks per illustration).
- Docs: ADR-096, TASK-062 task file, tasks README, HANDOFF.

## Deviations
None.

## New dependencies
None (`@pdf-lib/fontkit` was already used by the guide PDF).

## Test results (this session, 2026-11-15)
- `pnpm lint` — 0 errors. `pnpm typecheck` — clean.
- `pnpm test` — all unit tests passed (see PR).
- `pnpm test:int src/server/design src/server/ads src/server/video src/server/images` — 4 files, 61 passed.

## Deliberate breaks
- `fitText` stopping at the minimum again → 2 failed (`expected 108 to be less than 108`, `expected 30 to be 15`); restored → 24 passed.
- `pickLogo` returning the first logo → 3 failed in `logo-pick.test.ts`; composition hint off → 1 failed in `composition.test.ts`; restored → 62 passed.
- Old check condition (no check without references) → `every illustration is checked …` failed (`expected [ 'plan_post_images' ] to deeply equal …`); restored → passed.

## NOT RUN
- Full e2e locally — left to CI (no UI change).

## Open
- Re-run the four failed pilot posts after deploy; then the full round.

# TASK-062 feedback — part 2 (re-run fixes, ADR-097)

## What I implemented
`textBand` / `textScrim` (fade under the text on full-bleed pictures without an overlay); kept word groups drawn with
the normal gap; `compositionHint` uses `textBand`.

## Test results (this session)
- `pnpm test` — 269 passed. `pnpm test:int src/server/design src/server/ads src/server/video src/server/images` — 61 passed.

## Deliberate breaks
- Scrim not drawn → `a bright picture under the headline is darkened …` failed (`expected false to be true`); restored → 6 passed.
- Old no-break space rendering → `words kept together are spaced like any other words` failed (`expected 14 to be less than or equal to 4`); restored → passed.
