# TASK-005b feedback
Status: **DONE** pending the owner's upload check on dev — part 1 (server side) PR #14 (merged, deployed: Deploy dev for 38b9508 green); part 2 (upload UI + routes + E2E) PR #15.

## What I implemented (part 1)
- `src/server/files/storage.ts` S3 client (lazy, env-driven), presign ≤ 15 min (default 5), RFC 6266 file names.
- `src/server/files/sniff.ts` magic-byte sniffing incl. OOXML by ZIP part names (header-only, no decompression).
- `src/server/files/font.ts` in-house TTF/OTF reader (cmap format 4/12, name table) + diacritics check.
- `src/server/files/images.ts` sharp re-encode (metadata stripped, 40 MP limit, size caps).
- `src/server/brands/files.ts` upload / list / URL / delete with owner/editor rules, limits, duplicates, compensation.
- Migration `0007_brand_files`; S3 env in `config/deploy.dev.yml`, `.kamal/secrets.dev`, deploy workflow; S3 stand-in (moto) in CI.

## Deviations
- Local/CI S3 stand-in is **moto**, not MinIO (MinIO stopped publishing community images; moto needs no Docker). docker-compose MinIO kept as an option.
- No SVG logos, no WOFF/WOFF2, no legacy Office formats (ADR-033).
- Fonts without Slovenian diacritics are refused only for brands with `sl` among their languages; others store the gap in `meta.missingGlyphs`.

## New dependencies
- `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` — S3 API and presigned URLs (architecture §Storage, ADR-006).
- `sharp@0.34` — image re-encoding (architecture §Rendering, ADR-009); prebuilt linux-x64 glibc binary, traced into the standalone build.
- No file-type / fontkit: sniffing and font parsing in-house (ADR-033).

## Test results (real outputs, this session)
```
2026-10-05T20:34:14+02:00
$ pnpm lint   (no output = 0 problems)
$ pnpm typecheck
$ pnpm test
 Test Files  9 passed (9)
      Tests  81 passed (81)
$ pnpm test:int
 Test Files  7 passed (7)
      Tests  93 passed (93)
$ pnpm build
build exit 0 (after the env type fix; rerun 20:36)
```
(typecheck failed once on the test's env literal type; fixed in storage.ts and re-run: `tsc --noEmit` clean, build exit 0.)

## Deliberate breaks (2026-10-05T20:37)
```
## Break A: URL lookup not scoped to the caller's org
     × org B cannot list, get a URL for, or delete org A's files — A's row and object stay
      Tests  1 failed | 21 passed (22)
## Break B: storage key without the org prefix
     × source PDF: key is org/<org>/brand/<brand>/pdf/<uuid>.pdf, …
     × keys of different orgs never share a prefix, even for identical files
      Tests  2 failed | 20 passed (22)
## Break C: no compensation when the row insert fails
     × row insert fails after the put → the object is removed again (no orphan)
      Tests  1 failed | 21 passed (22)
## Break D: any ZIP accepted as docx
     × every accepted source type gets its kind and extension from the bytes, not the name
     × wrong type for the slot, garbage and empty files are refused and nothing is stored
      Tests  2 failed | 20 passed (22)
## Break E: glyph check ignored
     × font: full coverage stored with family; missing č/š/ž refused for a Slovenian brand, …
      Tests  1 failed | 21 passed (22)
## Break F: no pixel limit
     × refuses decompression bombs (pixel limit) and garbage
      Tests  1 failed | 10 passed (11)
## Restored
      Tests  22 passed (22)
      Tests  11 passed (11)
```

## NOT RUN
- Against the real Hetzner bucket — no credentials in the sandbox (by design). First real use is the part-2 smoke on dev by the owner.
- E2E — no UI yet (part 2).

## Open questions / risks
- Hetzner path-style vs virtual-host addressing: dev uses the SDK default (virtual-host); if the first real upload fails with a DNS/addressing error, set `S3_FORCE_PATH_STYLE=1` in `config/deploy.dev.yml`.
- Brand rows are archived, not deleted; if a brand/org row is ever hard-deleted, the cascade removes rows but not S3 objects (cleanup job later).


---

# Part 2 — upload UI and routes

## What I implemented
- `src/server/brands/files-http.ts`: upload handler (same-origin check, 401, slot, Content-Length gate before parsing, error → status) and download handler (302 to a 5-minute presigned URL; other org 404, anonymous 401).
- Routes `POST /api/brands/[id]/files`, `GET /api/brand-files/[table]/[id]` (wiring only).
- Brand page section "Datoteke branda" (`files-section.tsx`): logo previews, fonts with diacritics status, sources table; `upload-form.tsx` (multi-file, per-file result); `deleteBrandFileAction`. sl + en strings.

## Found by tests
- axe: `role="status"/"alert"` directly on `<li>` broke list semantics (`list` violation) — moved into a `<span>` inside the item.
- E2E: Chromium exposes `<input type=file>` as a button named by its label ("Naloži logotip"), so a non-exact "Naloži" button locator hit the file input — locators use exact names.

## Deviations
- Route context typed explicitly (`{ params: Promise<…> }`) instead of the generated `RouteContext` helper — `pnpm typecheck` runs before `next build` in CI, when the generated types don't exist yet.
- No `docs/guides/` exists yet; the owner-visible steps are in HANDOFF "Owner's open actions".

## Test results (real outputs, this session)
```
2026-10-05T21:36:04+02:00
$ pnpm lint
lint problems: 0
$ pnpm typecheck
typecheck: ok
$ pnpm test
 Test Files  10 passed (10)
      Tests  86 passed (86)
$ pnpm test:int
 Test Files  9 passed (9)
      Tests  111 passed (111)
$ pnpm build
build exit 0
$ pnpm test:e2e
  4 skipped
  26 passed (55.6s)
```

## Deliberate breaks (2026-10-05T21:38)
```
## Break A: no Origin check
     × cross-site or missing Origin → 403 before anything else; anonymous → 401
      Tests  1 failed | 5 passed (6)
## Break B: size gate removed (body read regardless of Content-Length)
     × size is refused from the header before the body is read: limit + overhead + 1 → 413, real small body → 201
      Tests  1 failed | 5 passed (6)
## Break C: download without login check (404 instead of 401)
     × another org gets 404 (no URL leaks), anonymous 401, unknown table 404
      Tests  1 failed | 5 passed (6)
## Restored
      Tests  6 passed (6)
```

## NOT RUN
- Real Hetzner bucket — first real upload is the owner's check on dev (HANDOFF, owner's open actions).
