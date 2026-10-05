# TASK-005a feedback
Status: **DONE** (PR to dev). Uploads are TASK-005b (waits for S3 from the owner).

## What I implemented
- Migration `0006_brands`: `brands`, `brand_profile_versions`, `channels` (all `org_id`, FKs, unique slug per org, unique version per brand, unique handle per brand+platform).
- Service (`src/server/brands`): create/update/archive brand, immutable versioned profile save (row lock), channels add/update/remove, reads; owner-only writes; brand limit; zod validation.
- App shell (`/app` layout with navigation), `/app/brands`, `/app/brands/new`, `/app/brands/[id]` (CGP editor, pillars, rules, colours, image style, channels with effective rules, version list).

## Found by tests
- `z.url()` accepted `javascript:alert(1)` as a brand website — would be XSS when rendered as a link. Restricted to http(s) (ADR-031).
- Two inputs shared the label "Največ hashtagov" (profile and channel) — ambiguous for screen readers; channel field relabelled.
- Instagram channel showed "povezave OK" although caption links are not clickable there — now "povezave niso klikljive".

## Test results (real outputs, this session)
```
2026-10-05T19:43:54+02:00
$ pnpm lint
lint: 0 problems
$ pnpm typecheck
typecheck: ok
$ pnpm test
 Test Files  8 passed (8)
      Tests  70 passed (70)
$ pnpm test:int
 Test Files  6 passed (6)
      Tests  71 passed (71)
$ pnpm build
build warnings+errors: 0
$ pnpm test:e2e
  2 skipped
  22 passed (27.8s)
```

## Deliberate breaks
```
2026-10-05T19:42:55+02:00
## Break A: editors may configure brands
     × editor can read but not create, change, archive or configure 148ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 19 passed (20)
## Break B: profile save without row lock
     × 10 concurrent saves get versions 2..11 without gaps or duplicates 186ms
     × profile validation: pillar shares ≤ 100, unique names, CTA required with mustEndWithCta, bad regex, bad hex 1006ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
      Tests  2 failed | 18 passed (20)
## Break C: addChannel trusts the brand id without checking the org
     × archived brands cannot be changed 158ms
     × org B cannot read, change, version, archive or add channels to org A's brand — A's data unchanged 153ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
      Tests  2 failed | 18 passed (20)
## Break D: website accepts any URL scheme
     × validation: name, slug, languages, website 154ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 19 passed (20)
## Restored
      Tests  20 passed (20)
```
Break B also failed the neighbouring validation test (side effect of the failed concurrent transactions); after restore all 20 pass.

## Docs updated
technical/brands.md (new), technical/rules.md, technical/README.md, 03-DECISIONS.md (ADR-031), tasks/README.md, HANDOFF.md.
