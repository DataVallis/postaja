# TASK-059 feedback
Status: DONE

## What I implemented
Launch scope (ADR-094): ad sets and competitor research hidden for customers, only Solo on sale, a per-organization
switch for hidden features in /admin, guide and texts aligned.

## Files changed (path — why)
- `src/server/billing/catalog.ts` — `ON_SALE`, `PILOT_ON_SALE`, `HIDDEN_FEATURES`, `planFeatures(…, extra)`, `featureOffer`, `featureVisible`; Solo and trial include `animation`; `planFor` removed (replaced by `featureOffer`).
- `src/server/billing/features.ts` — `orgFeatures` reads `extra_features`.
- `src/server/billing/service.ts` — Checkout refuses plans / pilot not on sale (`NOT_ON_SALE`).
- `src/server/db/schema/org.ts`, `drizzle/0054_org_extra_features.sql` (+ snapshot, journal) — `org_settings.extra_features text[] not null default '{}'`.
- `src/server/orgs/service.ts`, `src/server/admin/queries.ts`, `src/app/admin/{actions.ts,forms.tsx,orgs/[id]/page.tsx}` — super admin switch, validated and audited.
- `src/app/app/brands/[id]/page.tsx`, `…/setup/page.tsx` — tabs and wizard links by `featureVisible`.
- `src/components/upgrade-card.tsx` — nothing without an offer; add-on wording for the persona.
- `src/app/app/team/billing-section.tsx` — plans on sale only, no pilot.
- `src/server/guide/{guide.ts,pdf.ts}`, `src/app/app/help/**`, `src/app/api/help/pdf/route.ts` — chapters by feature.
- `messages/{sl,en}.json` — new texts, plural forms on the plan card, signup intro, add-on error.
- `docs/guides/user/{sl,en}/{01,02,04,09}*.md` — guide without hidden tools and unsold plans.
- Tests: `addons.int.test.ts`, `billing.int.test.ts`, `admin.int.test.ts`, `guide.test.ts`, e2e `billing`, `ads`, `competitors`, `help`.
- Docs: ADR-094, `LAUNCH-PLAN.md`, manifest, HANDOFF, tasks README, technical `billing`, `admin`, `help`, `brands`.

## Deviations from the task (and why)
- Brand tabs were not reduced further and the wizard was not shortened: the owner kept persona, reel and animation
  visible, so only the two hidden tabs go (9 → 7). Folding the video sections is an open owner question (LAUNCH-PLAN).
- The pilot's integration test no longer buys the pilot (not on sale); it starts from the paid webhook, which is what
  still has to work.

## New dependencies
None.

## How to verify
- A trial or Solo organization: brand page has no *Oglasi* / *Konkurenca* tab; `?tab=ads` shows *Nova objava*;
  *Ekipa in paket* offers only Solo; *Pomoč* has 8 chapters.
- /admin → organization → *Skrite funkcije* → tick *Oglasni seti* → *Shrani* → the brand's *Oglasi* tab is back.

## Test results (this session, 2026-11-15)
- `pnpm lint` — 0 errors (1 old warning in `tests/e2e/client-review.spec.ts`).
- `pnpm typecheck` — clean.
- `pnpm test` — 44 files, 257 tests passed.
- `pnpm test:int` — 35 files, 359 passed, 1 failed: `migrate.int.test.ts > vector type works after migration`
  (`type "vector" does not exist`). Local only: this sandbox has no pgvector package, a stand-in extension without the
  type was used so the migrations run. CI has the real extension.
- `pnpm test:e2e` (desktop + mobile) — 45 passed, 1 failed (`help.spec.ts`, expected 10 chapters); test updated to
  the 8 visible chapters, rerun alone: 1 passed.

## Deliberate breaks
- Checkout guard commented out → `billing.int.test.ts … only Solo is sold (ADR-094)` failed:
  `AssertionError: promise resolved "'https://checkout.stripe.test/2'" instead of rejecting` → restored → 15 passed.
- Hidden-feature filter in `planFeatures` disabled → `addons.int.test.ts … launch scope (ADR-094)` failed:
  `expected [ 'ads', 'animation', 'research' ] to deeply equal [ 'animation' ]` → restored → passed.

## NOT RUN
- Full e2e rerun after the `help.spec.ts` change — only that spec was rerun (the change is in the test file alone).
- pgvector check locally — see above.

## Docs updated
See "Files changed".

## Open questions / risks
- Existing Studio / pilot / trial organizations on dev lose ad sets and research; switch them on per organization
  where wanted.
- Solo now includes animations and the reel (credits per action unchanged).
