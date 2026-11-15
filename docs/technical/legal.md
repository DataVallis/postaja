# Terms of use

Status: **Built** (TASK-060). Decision: ADR-095. Owner: business users only, no refunds (2026-11-15).

## What
- **/terms** — public page with the terms of use in the visitor's language. Slovenian (`docs/legal/terms.sl.md`) is
  binding; English (`terms.en.md`) is a translation; other languages read the Slovenian text.
- **Signup** — the box "Postajo uporabljam za svojo dejavnost … in sprejemam pogoje uporabe" is required; the request
  stores the version and the trial organization gets it when it is created.
- **Paket in plačilo** — an organization that has not accepted the current version sees a card with the same box and
  *Potrjujem*; plan buttons are disabled until then. Only the owner can accept.
- **/admin → organization** — shows the accepted version and date, or that the terms are not accepted yet.

## How
- `src/lib/legal/terms.ts` `TERMS_VERSION` — bump it with every change of the text; organizations on an older version
  are asked again before their next purchase.
- `src/server/legal/terms.ts`: `termsText(locale)` (Markdown parsed by the guide's parser, never raw HTML),
  `termsAccepted(db, orgId)`, `acceptTerms(db, ctx, confirmed)` (owner only, box required, idempotent, audit
  `org.terms.accept`).
- `requestSignup` refuses without `accept: true` (`TERMS`) and stores `signup_requests.terms_version`; `startTrial`
  copies it to `org_settings.terms_version / terms_accepted_at / terms_accepted_by`.
- `checkoutUrl` refuses plans and credit packs with `BillingError("TERMS")` until `termsAccepted`.
- Migration 0055. `next.config.ts` ships `docs/legal/*.md` with `/terms`.

## Not built
- Deleting an organization's content 30 days after its subscription ends (terms clause 6.4 allows it): manual for now.
- Privacy policy (the terms refer to it at postaja.eu).

## Tests
`src/server/legal/terms.test.ts` (both languages, same clauses, the owner's decisions in the text),
`signup.int.test.ts`, `billing.int.test.ts` (refusal, owner only, version change), e2e `signup`, `billing`, `credits`,
`smoke` (public page, both languages, accessibility).
