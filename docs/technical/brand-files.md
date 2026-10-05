# Brand files (logos, fonts, sources)

Status: **Built** (TASK-005b part 1: server side; upload UI = part 2). Decisions: ADR-006, ADR-033.

## Where things live
| What | Where |
|---|---|
| Bytes | S3 bucket (dev: Hetzner Object Storage `postaja-dev`, fsn1; local/CI: moto on `127.0.0.1:9000`) |
| Rows (source of truth for access) | `brand_sources` (pdf/docx/xlsx/csv/pptx/text/image, `status` for TASK-006), `brand_assets` (logo/font, `meta`) — `drizzle/0007_brand_files.sql` |
| Key format | `org/<orgId>/brand/<brandId>/<kind>/<uuid>.<ext>` — built in `storageKey()`, never from input |
| Service | `src/server/brands/files.ts`: `uploadBrandFile`, `listBrandFiles`, `brandFileUrl`, `deleteBrandFile` |
| Checks | `src/server/files/sniff.ts` (magic bytes, OOXML part names), `font.ts` (cmap/name, diacritics), `images.ts` (sharp re-encode), `storage.ts` (S3 client, presign ≤ 15 min, Content-Disposition) |

## Upload flow
1. Owner of the brand's org (`ctx.role === "owner"`), brand found via `forOrg`, not archived.
2. Size ≤ slot limit (logo/font 10 MB, source 50 MB; inclusive) → sniff → slot allows type? → images re-encoded / fonts parsed / text checked as UTF-8.
3. Count limit per slot and duplicate check (sha256 of the uploaded bytes per brand).
4. `PutObject` → insert row via `forOrg`. Insert fails → object deleted again.

## Reading and deleting
- `brandFileUrl`: row looked up via `forOrg` (another org's id → `NOT_FOUND`), then a presigned GET (5 min). PNG/JPEG open inline, everything else downloads; the name is sent RFC 6266 (`filename*=UTF-8''…`).
- `deleteBrandFile` (owner): row deleted via `forOrg` first (access ends), then the object; a failed object delete is logged by key only.

## Env
`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` (clear, `config/deploy.dev.yml`), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (secrets: GitHub env `dev` → deploy workflow → `.kamal/secrets.dev`), `S3_FORCE_PATH_STYLE=1` only for the local/CI stand-in. The client is created on first use, so the app starts without S3.

## Tests
- Unit `src/server/files/files.test.ts`: every type sniffed, look-alikes refused (truncated PDF signature, ZIP without OOXML parts, legacy OLE, EXE, NUL bytes, invalid UTF-8), ZIP directory corruption, fonts (format 4/12, all-but-one diacritic, truncated, zero tables), sharp (EXIF stripped, 2048/2049 and 4096/4097 px, 40 MP limit exactly / +1 row), Content-Disposition, missing env names without values.
- Integration `src/server/brands/files.int.test.ts` (real Postgres + S3 stand-in): key format and byte-exact download, kinds from bytes, logo re-encode, glyph rule per brand language, refusals store nothing, size limit exact/+1, duplicates, count limit, editor read-only, archived, delete + dead URL, S3 down → no row, insert fails → no orphan, presign 300/900/901 s, org B cannot list/URL/delete/upload into A (row and object verified), key prefixes per org, cross-tenant harness for both tables.
- Fixtures are built in code (`tests/fixtures/files.ts`): fonts, OOXML ZIPs, PDFs, images.
