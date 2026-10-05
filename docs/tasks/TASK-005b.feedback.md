# TASK-005b feedback
Status: **PARTIAL** — part 1 (server side) done in this PR; part 2 (upload UI + E2E) next.

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
