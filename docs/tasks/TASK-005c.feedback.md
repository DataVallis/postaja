# TASK-005c feedback
Status: **DONE** (PR to dev) — owner check on dev pending.

## What I implemented
- `src/server/files/zip.ts`: central-directory unzip with capped inflation and limits; junk filter.
- `src/server/files/font.ts`: `woffToSfnt` (in-house), `woff2ToSfnt` (wawoff2); `sniff` knows woff, woff2, zip, svg.
- `src/server/brands/files.ts`: `classify`, `uploadAuto` (single file or ZIP, per-file results), web-font conversion in `prepare`.
- HTTP: slot optional (auto), `{ results }` response; single failures keep their status.
- Brands: channel language must be a brand language (`LANGUAGE_NOT_IN_BRAND`); form offers only brand languages, default first.
- UI: `file-uploads.tsx` (Dropzone, AddLogoButton, FontSample), new `files-section.tsx` layout, section moved above the CGP form; sl/en strings rewritten.

## Found by tests
- Self-closing `<svg/>` slipped through the first SVG pattern and would have been stored as text — pattern fixed, case added.
- The first ZIP-bomb test passed even without the inflate cap (the entry was still rejected after full inflation, i.e. after the memory was spent). Added `inflateCapped` + a direct test that inflation stops at the cap (Break A).

## Deviations
- WOFF2 needs a complete font, so tests use a committed 1.2 KB self-made font (`tests/fixtures/fonts/TinySans.ttf`, generator script next to it) instead of a code-built one.
- Images go to logos only by name ("logo" in the file name) or via "Dodaj logotip"; no AI guessing of what is a logo (could come with TASK-006 vision).

## New dependencies
- `wawoff2@2.0.1` (MIT, Google's woff2 compiled to WebAssembly) — WOFF2 → TTF. Owner asked for WOFF2 support (2026-10-06).

## Test results (real outputs, this session)
```
2026-10-06T06:40:57+02:00
$ pnpm lint
lint problems: 0
$ pnpm typecheck
typecheck: ok
$ pnpm test
 Test Files  10 passed (10)
      Tests  94 passed (94)
$ pnpm test:int
 Test Files  9 passed (9)
      Tests  116 passed (116)
$ pnpm build
build exit 0
$ pnpm test:e2e
  4 skipped
  26 passed (33.8s)
```
(After these runs `inflateCapped` was extracted and a test added: unit `Tests  20 passed (20)`.)

## Deliberate breaks (2026-10-06T06:42–06:43)
```
## Break A: inflate without output cap
     × inflateCapped never produces more than the cap (memory guard): a 64 MB bomb stops at 1 MB
      Tests  1 failed | 19 passed (20)
   (first attempt, before inflateCapped existed: NOT detected — Tests 19 passed; see "Found by tests")
## Break B: OS junk not skipped
     × stored and deflated entries come back byte-exact; folders and OS junk are skipped
      Tests  1 failed | 18 passed (19)
## Break C: SVG detection off (stored as text)
     × svg in its usual shapes; text that merely mentions <svg> stays text
      Tests  1 failed | 18 passed (19)
     × one ZIP is unpacked and every entry is checked and filed on its own
     × a single file still goes to its slot; a forced slot wins; …
      Tests  2 failed | 24 passed (26)
## Break D: channel language not checked against brand
     × an English-only brand cannot get a Slovenian channel (add or update); English is fine
      Tests  1 failed | 20 passed (21)
## Restored
      Tests  20 passed (20)   (unit)
      Tests  53 passed (53)   (brands integration)
```

## NOT RUN
- Real Hetzner bucket with a ZIP — owner check on dev.

## Docs updated
ADR-034; docs/technical/brand-files.md, brands.md; tasks README, this spec + feedback; HANDOFF.
