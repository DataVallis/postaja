# TASK-062 — Quality round before launch
Depends on: TASK-059, TASK-060
Read first: docs/LAUNCH-PLAN.md, docs/03-DECISIONS.md (ADR-096, ADR-076, ADR-044), docs/technical/images.md

## Goal
Posts and images that a paying user accepts without manual correction in at least 90 % of cases.

## How
1. **Pilot** (8 posts, every platform and both image formats) on the owner's brands on dev → defects → fixes with
   regression tests → one PR.
2. **Pilot again** on the same briefs after deploy → confirm the defects are gone.
3. **Full round** (~60 posts: 5 brands × their channels × single image / carousel / text) → score → fixes → PR.
4. Owner reviews a sample of the scored posts.

## Scoring (per post)
Text: follows the CGP and the brief, facts only from the CGP/materials, within platform limits.
Images: exact size, no text running out of its box, no made-up writing, logo visible, picture not under the text,
brand look. **Usable** = publishable as it is.

## Pilot results (2026-11-15, dev, before ADR-096)
| # | Brand · channel | Format | Text | Images | Usable | Defect |
|---|---|---|---|---|---|---|
| 1 | inzenirji.si · Instagram | single image | good (375/2200, 5/5 #) | headline over the footer line, "h" alone on a line | no | D1 |
| 2 | inzenirji.si · Facebook | carousel 6 | good | clean | yes | ("h" at line end, D1) |
| 3 | aibuilders.si · Instagram | carousel 7 | good | cover: logo a dot, picture under the subtitle | no | D2, D3 |
| 4 | petprep.si · Instagram | single image | good | clean | yes | — |
| 5 | davidtacer.com · LinkedIn | single image | good | made-up lettering in the illustration | no | D4 |
| 6 | petprep.si · LinkedIn | single image | good | clean | yes | — |
| 7 | cherr.io · X | single image | good (268/280) | clean; partner "Polygon" as text (no partner logo uploaded) | yes | owner: upload the logo |
| 8 | aibuilders.si · X | thread 2 + image | good (270/280) | logo nearly invisible, text over the picture | no | D2, D3 |

Texts 8/8 usable; images 4/8 usable. Cost of the pilot: 1.60 € (dev spend 2.02 € → 3.62 €).

Defects → fixes (ADR-096): D1 text fitting and one-letter words; D2 logo choice by contrast; D3 composition hint for
full-bleed pictures; D4 every illustration checked at a readable size, checked again after a redraw.

Also seen: a carousel asked for "4 slides" has 6 images (cover + 4 + closing) — acceptable; the aibuilders.si
Instagram channel is set to Slovenian while the brand writes English (warning shown on the channel).
