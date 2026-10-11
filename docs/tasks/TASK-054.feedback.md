# TASK-054 — feedback (2026-10-11)

## What was built
- Post images: "Slika N / M · <predloga>" on every card; *Popravi to sliko* (carousels) + *Ilustracijo nariši znova* on
  the correction form; `requestImages(..., { only, redraw })` → `pickedSlides` (BAD_PICK) → job `only`/`redraw` →
  Claude told the picks → `mergePicked` keeps unpicked images verbatim and the image count; `visual.revisedSlides`.
- *Obnovi sliko N* under each image of an earlier version → `restoreSlideFromVersion` (same design version, stored
  illustration; else NOT_RESTORABLE) → free `text` redraw.
- Vizualna podoba: *Popravi to predlogo* → `only_templates` → `mergePickedTemplates`; *Vrni eno predlogo iz te
  verzije* → `restoreDesignTemplate` (new ready version, `restored_from`, no AI call).
- Migration `0048_design_template_scope.sql`, ADR-079, guides SL/EN (03, 04), `technical/images.md`.

## Local environment (this session)
Postgres 16 + pgvector (native), moto S3 stand-in on :9000, Chromium from /opt/pw-browsers.

## Outputs
```
$ pnpm typecheck            → (no output, exit 0)
$ pnpm lint                 → ✖ 1 problem (0 errors, 1 warning)   # existing warning in tests/e2e/client-review.spec.ts
$ pnpm test                 → Test Files 40 passed (40) · Tests 242 passed (242)
$ pnpm test src/server/images/pick.test.ts → Tests 12 passed (12)
$ pnpm test:int             → Test Files 30 passed (30) · Tests 326 passed (326) · Duration 221.70s
$ pnpm test:int design.int.test.ts -t TASK-054 → Tests 5 passed | 24 skipped (29)
$ pnpm build                → exit 0
$ pnpm test:e2e tests/e2e/images.spec.ts
  ✓ [desktop] images: brand design by Claude, revision, versions, a post's images, word edits, bulk carousel (1.9m)
  - [mobile] (skipped by the spec)
  1 passed (2.0m)
```

## Deliberate breaks
1. `mergePicked` returns Claude's answer as is (`const slides = answer;`):
   ```
   × only the picked images change, whatever Claude answers for the others; the number of images stays
   AssertionError: expected [ { …(6) } ] to have a length of +0 but got 1     (a paid illustration for an unpicked image)
   Tests 1 failed | 4 passed | 24 skipped (29)
   ```
   restored → `Tests 5 passed | 24 skipped (29)`.
2. Design merge skipped (`const parsed = answer;`) and the per-image restore without swapping the illustration:
   ```
   × redraw: the picked image gets a new illustration (one paid), the others keep theirs; it can be brought back for free
   × design: a revision of picked templates keeps everything else as it was
   AssertionError: expected { …(2) } to deeply equal { …(2) }
   AssertionError: expected 'Vse drugače' to be 'Dark night-blue cards, one red accent…'
   Tests 2 failed | 3 passed | 24 skipped (29)
   ```
   restored → full file `Tests 29 passed (29)`.
3. Unit test caught a real bug while writing: a picked image without an illustration kept Claude's `redraw` flag
   (`expected [ true, true, false ] to deeply equal [ true, false, false ]`) → fixed in `mergePicked`.

## Notes
- Per-image restore is offered only for versions made with the design version the post uses now; older ones are
  restored as a whole version (as before) — otherwise the image would have to be planned and paid again.
- The owner's grey rectangle on the AI Builders cover comes from the brand template (owner confirmed) — not touched here;
  with this task it can be fixed on that one image, or on the template via *Popravi to predlogo*.
