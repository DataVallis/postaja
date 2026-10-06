# TASK-005c — Smart uploads (owner feedback 2026-10-06)
Depends on: TASK-005b
Read first: ADR-033, ADR-034, docs/technical/brand-files.md

## Owner feedback (2026-10-06, translated)
- WOFF2 fonts are not accepted.
- The č/š/ž note shows for an English-only brand; a new Instagram channel on that brand defaulted to Slovenian.
- The big orange "Naloži" button does not open the file picker (you have to click the text first) — poor UX; the whole thing should look better (Tailwind), a dropzone would be good, and uploads should be smarter, e.g. drop a ZIP with all kinds of files.

## Scope
- Accept WOFF/WOFF2, convert to TTF/OTF on upload.
- Diacritics note/requirement only for brands with `sl`; channel language limited to brand languages (form + server).
- One dropzone (click anywhere / button / drag & drop) with per-file results; automatic sorting; "Dodaj logotip"; font preview in the uploaded font; section above the CGP form.
- Plain ZIPs unpacked server-side with limits; SVG detected and refused with a reason.

## Tests
Unit, integration and E2E as listed in docs/technical/brand-files.md (TASK-005c bullets); deliberate breaks for the inflate cap, junk filter, SVG detection, channel language rule.

## Acceptance
Owner drops a ZIP of a brand folder (logo, WOFF2 font, PDFs) on dev and sees each file filed; an English brand shows no diacritics note and only English for channels.
