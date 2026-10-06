# Brands, profile versions, channels

Status: **Live on dev** (TASK-005a, PR #10). File uploads follow in TASK-005b.

## Model (tenant tables, all with `org_id`, accessed only through `forOrg`)
| Table | Notes |
|---|---|
| `brands` | name, slug (unique per org), website (http/https only), languages, `current_profile_version_id`, `archived_at` |
| `brand_profile_versions` | immutable; `version` 1.. per brand (unique); `cgp` (≤ 50,000 chars), `rules`, `pillars`, `visual`, `note`, `created_by` |
| `channels` | platform, handle (unique per brand+platform), language (must be one of the brand's languages — `LANGUAGE_NOT_IN_BRAND` on add/update; the form offers only those, default = first), goal `{postsPerDay 0–10, weekdays 1–7}`, channel `rules` (captionMax, hashtagsMax, linksAllowed), `allowed_types`, `default_preset_key` (FK, same platform, enabled) |

## Rules
- **Owner** creates/edits/archives brands, saves profiles, manages channels; **editor** reads (ADR-031).
- `saveProfile` → new version under `SELECT … FOR UPDATE` on the brand; old versions never change. Archived brands are read-only.
- Brand limit: `org_settings.limits.brands` (archived brands don't count).
- Pillars: ≤ 12, unique names, shares sum ≤ 100. Brand rules: banned words, CTA phrases, caption/hashtag/emoji limits, links allowed, must end with CTA (needs ≥ 1 CTA phrase), regexes validated.
- The brand page shows per channel the **effective rules** = platform ∩ channel ∩ brand (`effectiveRules`, TASK-004), and whether links are clickable on that platform.

## Code map
`src/server/brands/{schemas,service}.ts`, `src/server/db/schema/brands.ts`, `src/app/app/brands/**`, `src/app/app/layout.tsx` (app shell), `src/server/auth/require.ts`.

## Tests
Integration `src/server/brands/brands.int.test.ts`: roles, limits, validation (incl. `javascript:` website), versioning incl. 10 concurrent saves, archived, channels/presets, service-level cross-tenant (B cannot read/change/version/archive/add channels to A's brand), and `crossTenantSuite` for `brands`, `brand_profile_versions`, `channels`.
E2E `tests/e2e/brands.spec.ts`: owner creates brand, saves CGP (v2), invalid pillars error, adds Instagram channel, effective rules "2200 znakov · 3 hashtagov · povezave niso klikljive", axe.
