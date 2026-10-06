# TASK-008 — CGP from a document
Depends on: TASK-005c
Read first: ADR-035, ADR-037; docs/technical/brands.md, brand-files.md

## Goal
The owner fills the CGP from an existing Word/PDF/Markdown/text document — from the computer or an uploaded source — with the text copied verbatim (no AI), reviews it and saves a version.

## Scope
`src/server/files/extract.ts` (PDF via unpdf, DOCX in-house, TXT/MD); `cgpTextFromDocument` + `handleCgpImport` + route; `CgpImport` UI in the profile editor; strings; updated CGP hint (no "AI builds it").

## Tests
Unit extraction (PDF with Slovenian text, DOCX headings/lists/entities, TXT tidy, refusals); integration (owner/editor, tenancy, other brand's source, archived, 50,000 boundary, HTTP statuses); E2E (DOCX from computer, PDF from uploaded source, save version).

## Acceptance
On dev the owner imports a CGP from a Word file and saves it as a new version.
