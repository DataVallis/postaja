# TASK-059 — Launch scope: hide ads and competitor research, sell only Solo
Depends on: TASK-053 (plan features), TASK-036 (billing)
Read first: docs/00-MANIFEST.md, docs/03-DECISIONS.md (ADR-094, ADR-083, ADR-073), docs/LAUNCH-PLAN.md, docs/technical/billing.md

## Goal
A new customer sees a simple program for making posts: no Oglasi tab, no Konkurenca tab, one plan (Solo). The owner
can still switch a hidden tool on for one organization.

## Scope
1. `src/server/billing/catalog.ts`: `ON_SALE`, `PILOT_ON_SALE`, `HIDDEN_FEATURES`, `planFeatures(plan, addons, extra)`,
   `featureOffer`, `featureVisible`; Solo and trial include `animation`.
2. `org_settings.extra_features text[]` (migration 0054), read by `orgFeatures`, set by `updateOrgSettings` (only hidden
   features, sorted, unique, audited), checkboxes in /admin → organization.
3. Pages: brand tabs, the setup wizard's summary, the help chapters and PDF, the upgrade card (nothing for a feature
   that cannot be bought; add-on wording for the persona), *Paket in plačilo* (plans on sale only, no pilot).
4. Checkout refuses plans and the pilot that are not on sale (`NOT_ON_SALE`); webhooks unchanged.
5. User guide (sl, en) and app texts aligned (signup intro, add-on error, plural forms on the plan card).

## Decisions already made (do not re-decide)
- ADR-094: what is hidden, what stays, only Solo, per-organization switch.
- Nothing is deleted: code, tables, guide chapters 06 and 10 stay.

## Tests
- Integration: plan features per plan, extra features, `featureOffer`/`featureVisible`, `requireFeature` on Solo with
  and without the switch, checkout `NOT_ON_SALE`, `updateOrgSettings` extra features + audit.
- Unit: guide chapters visible to Solo, no link into a hidden chapter (sl, en).
- E2E: billing (Solo only, no hidden tabs, add-on card), ads and competitors (switched on in /admin first).

## Must not touch
uat / main, servers, secrets, Stripe products.

## Allowed dependencies
None new.

## Acceptance criteria
- A Solo or trial organization has no Oglasi / Konkurenca tab and no upgrade card for them; Team shows one plan.
- An organization with the switch on has the tab and the tool works.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm test:e2e` pass; proof in the feedback.
