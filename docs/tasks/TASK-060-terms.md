# TASK-060 — Terms of use and business buyers only
Depends on: TASK-059, TASK-036, TASK-037
Read first: docs/03-DECISIONS.md (ADR-095, ADR-085, ADR-073), docs/LAUNCH-PLAN.md, docs/technical/billing.md

## Goal
A customer can read the terms of use, and nobody starts a trial or buys anything without confirming that they use
Postaja for their business and accept the terms.

## Scope
1. `docs/legal/terms.sl.md` (binding) and `terms.en.md`; `TERMS_VERSION`; public page `/terms`.
2. Signup: required box; version stored on the request and copied to the trial organization.
3. Purchases: acceptance card in *Paket in plačilo* for organizations without the current version; `checkoutUrl`
   refuses plans and packs with `TERMS`.
4. Acceptance on `org_settings` (migration 0055), audited, shown in /admin.

## Decisions already made (do not re-decide)
ADR-095: business users only, no refunds, 30 days of content after a subscription ends (right, not automated),
hello@postaja.eu, 60 days notice on shutdown.

## Tests
Unit: terms text in both languages. Integration: signup without the box, trial organization gets the acceptance,
checkout refusal, owner only, version change. E2E: signup, billing, credits, public page.

## Must not touch
uat / main, servers, secrets.

## Allowed dependencies
None new.

## Acceptance criteria
- `/terms` opens without an account in sl and en.
- Signup without the box sends no link; a purchase without acceptance is refused on the server.
- All checks pass; proof in the feedback.
