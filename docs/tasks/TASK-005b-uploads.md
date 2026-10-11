# TASK-005b — S3 storage and brand file uploads
Depends on: TASK-005a, owner S3 bucket + keys (done 2026-10-05)
Read first: docs/HANDOFF.md (Next), ADR-005, ADR-006, ADR-031, ADR-033; docs/technical/brands.md, tenancy.md

## Goal
The brand owner uploads a logo, fonts and brand sources; files are checked, stored privately per organization and readable only by members of that organization.

## Scope
Part 1 (server): S3 storage module; `brand_sources` + `brand_assets`; sniffing by magic bytes; fonts with diacritics check; images re-encoded by sharp; size/count limits; duplicates; presigned GET ≤ 15 min after a forOrg lookup; upload/delete owner-only; compensation on failure; S3 env in deploy config; S3 stand-in in CI.
Part 2 (UI): upload route handler, brand page sections (logo, fonts, sources) with list, preview/download, delete; E2E + axe.

## Owner requirement (do not weaken)
Keys `org/<orgId>/brand/<brandId>/<kind>/<uuid>.<ext>` generated server-side only; bucket private; DB row is the access check; cross-tenant tests for upload/read/delete/presign with deliberate breaks.

## Tests
Unit: sniffing, fonts, sharp limits (exact boundaries). Integration (real Postgres + S3 API): everything above incl. org B vs org A with row and object verified. E2E (part 2): upload each slot, wrong type error, download, delete, editor read-only.

## Acceptance
All checks green; on dev the owner uploads a logo, a font and a PDF to a brand and downloads them again; ADR-033 written.
