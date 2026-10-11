# TASK-008 feedback
Status: **DONE** (PR to dev) — owner check on dev pending.

## What I implemented
- `src/server/files/extract.ts`: `documentText` (PDF via unpdf, DOCX in-house over the safe unzip, TXT/MD), `docxToText`, `pdfToText`, `tidy`, `decodeXml`.
- `cgpTextFromDocument` (owner only, from a file or a source of this brand, 20 MB / 50,000-character limits) and `handleCgpImport` + `POST /api/brands/[id]/cgp-import`.
- Profile editor: "Uvozi iz dokumenta" + "ali iz naloženega vira" (`cgp-import.tsx`); the text replaces the field content, the owner saves a version. CGP hint no longer says AI builds it.

## Deviations
- Scanned PDFs are reported (`NO_TEXT`), not OCR'd.
- DOCX formatting kept: headings and list items only (bold/italics/tables are flattened to text).

## New dependencies
- `unpdf@1.8.1` (MIT) — PDF text via pdf.js in Node; will also serve TASK-009.

## Test results (real outputs, this session)
```
2026-10-06T07:53:41+02:00
$ pnpm lint
lint problems: 0
$ pnpm typecheck
typecheck: ok
$ pnpm test
 Test Files  12 passed (12)
      Tests  109 passed (109)
$ pnpm test:int
 Test Files  11 passed (11)
      Tests  137 passed (137)
$ pnpm build
build exit 0 (07:53)
$ pnpm test:e2e
  6 skipped
  28 passed (46.3s)
```

## Deliberate breaks (2026-10-06T07:55)
```
## Break A: source lookup ignores the brand (any source of the org)
     × owner only; another org's brand or source, or another brand's source, is NOT_FOUND; …
      Tests  1 failed | 4 passed (5)
## Break B: editors may import
     × owner only; …
     × 200 with the text; foreign Origin 403; anonymous 401; …; editor 403
      Tests  2 failed | 3 passed (5)
## Break C: Slovenian heading styles not recognised
     × DOCX: runs joined, headings (English and Slovenian style names) → #, …
      Tests  1 failed | 4 passed (5)
## Break D: XML entities not decoded
     × DOCX: runs joined, headings …, entities decoded
      Tests  1 failed | 4 passed (5)
## Restored
      Tests  5 passed (5)
      Tests  5 passed (5)
```

## NOT RUN
- A real CGP document of the owner (Word with complex layout) — owner check on dev.

## Docs updated
ADR-037; docs/technical/brands.md (+ maintenance map); tasks README (TASK-009 added); this spec + feedback; HANDOFF.
