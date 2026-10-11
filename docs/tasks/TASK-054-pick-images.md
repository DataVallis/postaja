# TASK-054 — Correct or bring back picked images and templates
Depends on: TASK-017, TASK-033, TASK-034
Read first: ADR-044, ADR-062, ADR-076, ADR-079; docs/technical/images.md

## Goal (owner, 2026-10-11)
"Rabim funkcijo, da ko mi generira karosel, da lahko samo eno ali določene slike menjam in napišem prompt, kaj mi ni ok,
kaj naj popravi. Tudi pri vizualni podobi mora biti opcija, da popravim, zamenjam samo eno sliko ali določene, seveda pa
moramo imeti zgodovino, da lahko tudi povrnemo prejšnje slike, saj je že plačano, kar je generirano."

## Scope
- Post images: every image labelled "Slika N / M · <template>"; *Popravi to sliko* checkboxes feed the correction
  in words; *Ilustracijo nariši znova* for the picked images (or all). Unpicked images stay verbatim (enforced in code),
  the number of images stays. Earlier versions: *Obnovi sliko N* brings back one image for free (same design version,
  illustration still stored).
- Brand design: *Popravi to predlogo* checkboxes limit a revision to the picked templates (others and the shared
  palette/typography/summary/style kept in code); *Vrni eno predlogo iz te verzije* puts one template of an earlier
  version into the current design as a new version, no AI call.
- Nothing is deleted (ADR-062). Migration `0048_design_template_scope.sql` (two nullable jsonb columns).

## Must not touch
New post generation, plan import, MCP tools, bulk.

## Tests
Unit `images/pick.test.ts` (pick boundaries 0 / count-1 / count / -1 / fractions, merges, prompts). Integration in
`design/design.int.test.ts` (picked image changes only, Claude's extra/changed images ignored, no fal and no ledger
row; redraw = exactly one paid illustration; one image back without Claude/fal/ledger, then forward again; other org
refused; other design version refused; picked templates keep the rest; template back without Claude, editor/other org
refused). E2E `images.spec.ts` (picked template, template back, labels, picked image 3, image 3 back, axe).
Deliberate breaks recorded in the feedback.

## Acceptance
On dev the owner picks one image of a carousel, writes what is wrong and only that image changes (cost: at most one
illustration); an earlier image comes back with *Obnovi sliko N* at no cost; on Vizualna podoba one picked template
changes and one template of an older version comes back.
