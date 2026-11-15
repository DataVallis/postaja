# TASK-060 feedback
Status: DONE

## What I implemented
Terms of use in the app (ADR-095): text in two languages, public page, acceptance at signup and before the first
purchase, stored per organization and audited.

## Files changed (path — why)
- `docs/legal/terms.{sl,en}.md` — the text agreed with the owner on 2026-11-15.
- `src/lib/legal/terms.ts`, `src/server/legal/terms.ts`, `src/app/terms/page.tsx`, `next.config.ts` — version, loading, acceptance, public page.
- `src/server/db/schema/{org,signup}.ts`, `drizzle/0055_terms_acceptance.sql` (+ snapshot, journal) — acceptance columns.
- `src/server/signup/service.ts`, `src/app/signup/{actions.ts,signup-form.tsx}` — required box, version stored and copied.
- `src/server/billing/service.ts`, `src/app/app/team/{actions.ts,billing-section.tsx,page.tsx}` — refusal before acceptance, acceptance card.
- `src/server/admin/queries.ts`, `src/app/admin/orgs/[id]/page.tsx` — shown to the super admin.
- `messages/{sl,en}.json` — texts.
- Tests: `terms.test.ts`, `signup.int.test.ts`, `billing.int.test.ts`, e2e `signup`, `billing`, `credits`, `smoke`.
- Docs: ADR-095, `technical/legal.md` (+ README map), HANDOFF, tasks README, LAUNCH-PLAN.

## Deviations from the task (and why)
- Automatic deletion of content 30 days after a subscription ends is **not** built: it is irreversible, the terms give
  a right and not a duty, and manifest rule 13 says nothing disappears unless the user deletes it (ADR-095).
- The acceptance is asked once per organization and terms version (not at every purchase), so later purchases stay
  one click; the terms state that every purchase is made as a business buyer.

## New dependencies
None.

## How to verify
- https://dev-postaja.inzenirji.si/terms → "Pogoji uporabe", 13 sections; with English selected → "Terms of use".
- /signup: without the box no link is sent.
- An invited organization → Ekipa in paket: plan buttons are disabled until *Potrjujem*; /admin → organization shows
  "Pogoji uporabe 2026-11-15 sprejeti …".

## Test results (this session, 2026-11-15)
- `pnpm lint` — 0 errors (1 old warning). `pnpm typecheck` — clean.
- `pnpm test` — 45 files, 259 passed.
- `pnpm test:int src/server/signup src/server/billing` — 3 files, 21 passed.
- `pnpm exec playwright test signup billing credits smoke --project=desktop` — 8 passed.

## Deliberate breaks
- Checkout terms check commented out → `billing.int.test.ts … only Solo is sold` failed:
  `promise resolved "'https://checkout.stripe.test/2'" instead of rejecting`.
- Signup box check commented out → `signup.int.test.ts … the box 'for my business + terms' is required` failed:
  `promise resolved "{ email: 'ana@pekarna.si' }" instead of rejecting`.
- Both restored → 21 passed.

## NOT RUN
- Full integration and e2e suites locally — left to CI (changes are limited to signup, billing, team, admin
  organization page and the new page).

## Docs updated
See "Files changed".

## Open questions / risks
- Lawyer review of the Slovenian text before public launch.
- Privacy policy is referenced but not written.
