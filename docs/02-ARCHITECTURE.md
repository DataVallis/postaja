# Postaja — Architecture

Version 0.2 · 2026-10-05 · Status of everything: **Planned**.
Decisions referenced as ADR-XXX live in `03-DECISIONS.md`.

---

## 1. Stack

| Area | Choice |
|---|---|
| App | Next.js (App Router, TypeScript), React Server Components, server actions + route handlers |
| UI | Tailwind CSS + shadcn/ui, design tokens, next-intl (sl, en) |
| DB | PostgreSQL 16 + pgvector (ADR-003) |
| ORM / migrations | Drizzle ORM + drizzle-kit |
| Auth | Better Auth — email/password + magic link, **organization** plugin, **admin** plugin (ADR-004) |
| Background jobs | pg-boss on Postgres, separate `worker` process from the same image (ADR-007) |
| LLM | Anthropic Claude API behind an `llm` adapter; JSON output validated with zod (ADR-010) |
| Images / video | fal.ai (`@fal-ai/client`) queue API + webhooks behind a `media` adapter; model registry (ADR-011) |
| Embeddings | behind an `embeddings` adapter — provider Open (ADR-008) |
| Rendering | Satori → SVG → `@resvg/resvg-js` → PNG; `pdf-lib` for carousel PDF; `sharp` for resize/format (ADR-009) |
| Storage | Hetzner Object Storage (S3 API) via `@aws-sdk/client-s3`, private buckets, presigned URLs (ADR-006) |
| Import | `papaparse` (CSV), `exceljs` (XLSX) |
| Brand ingestion | PDF + images → Claude directly (native PDF/vision input); `mammoth` (DOCX); `exceljs`/`papaparse` (sheets); PPTX via `jszip` + XML text extraction, slide images via LibreOffice headless in the worker; URL fetch + `@mozilla/readability` (ADR-018) |
| Image recompose | `sharp` + saliency smart crop; outpaint model on fal when crop would lose content (ADR-020) |
| Export | `archiver` (streamed ZIP) |
| Validation | zod everywhere at trust boundaries |
| Tests | Vitest (unit + integration on real Postgres), Playwright + axe (E2E, accessibility) |
| Deploy | Docker image → GHCR → **Kamal 2** on Hetzner Cloud, kamal-proxy with TLS (ADR-002) |
| Video tooling | ffmpeg in the worker image (phase 1b): text/logo/subtitle burn-in, stitching, transcoding to preset specs |

---

## 2. Components

```
Browser
  │ HTTPS
kamal-proxy (TLS)
  │
web  (Next.js: UI, API, server actions, webhooks)
  │  ├── Postgres (+pgvector, pg-boss schema)
  │  └── S3 (Hetzner Object Storage) — presigned URLs to browser
  │
  │ enqueue jobs (pg-boss)
  ▼
worker (same image, CMD=worker)
  ├── Claude API        (text, ideas, topic summaries)
  ├── Embeddings API    (no-repeat)
  ├── fal.ai queue      (images, video, LoRA) ──► webhook ─► web /api/webhooks/fal
  ├── Satori/resvg/pdf  (slides, overlays, PDF)
  └── S3                (store every asset; fal URLs expire)
```

Kamal roles: `web`, `worker`. Accessories: `postgres` (pgvector image, volume on the host).
Postgres is never exposed publicly (internal Docker network only).

---

## 3. Multi-tenancy (ADR-005)

- Shared database. Every tenant table has `org_id uuid not null` (FK, indexed).
- Active organization comes from the Better Auth session; membership and role are verified server-side on **every** request. `org_id` is never taken from the client.
- All tenant data access goes through `src/server/db/scoped.ts` (`forOrg(ctx)`), which adds `org_id` to every query and every insert.
- Super admin: `user.role = 'superadmin'` (admin plugin). `/admin` has its own layout and guard; every action writes `audit_log`.
- Storage keys: `org/<orgId>/brand/<brandId>/post/<postId>/<file>`. Presigned GET URLs (≤ 15 min) are issued only after an authorization check.
- Each resource has integration tests: user of org B cannot read / update / delete org A's rows; rows verified after the attempt.
- Postgres RLS as a second layer: Planned (later ADR).

---

## 4. Data model (main tables)

Better Auth owns: `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`.
Postaja extends `organization` via a 1:1 table.

| Table | Key columns |
|---|---|
| `org_settings` | `org_id` PK, `plan` (`trial`/`starter`/`pro`/`comped`), `status` (`active`/`suspended`), `spend_cap_micro_usd bigint`, `limits jsonb`, `repeat_thresholds jsonb` |
| `brands` | `id`, `org_id`, `name`, `slug`, `website`, `languages text[]`, `current_profile_version_id`, `persona_id?`, `archived_at?` |
| `brand_profile_versions` | `id`, `org_id`, `brand_id`, `version int`, `cgp text`, `rules jsonb`, `pillars jsonb`, `visual jsonb`, `created_by`, `created_at` |
| `brand_sources` | `id`, `org_id`, `brand_id`, `kind` (`pdf`/`docx`/`xlsx`/`csv`/`pptx`/`text`/`image`/`url`), `filename?`, `url?`, `storage_key?`, `sha256`, `status` (`uploaded`/`extracting`/`extracted`/`failed`), `extract jsonb` (text, tables, colors, detected role), `error?` |
| `brand_knowledge_chunks` | `id`, `org_id`, `brand_id`, `source_id`, `position`, `text`, `embedding vector(N)` (phase 2 retrieval) |
| `brand_profile_proposals` | `id`, `org_id`, `brand_id`, `base_version_id?`, `proposal jsonb` (fields + source refs), `conflicts jsonb`, `status` (`open`/`accepted`/`rejected`), `accepted_version_id?` |
| `brand_examples` | `id`, `org_id`, `brand_id`, `text`, `asset_id?` |
| `brand_assets` | `id`, `org_id`, `brand_id`, `kind` (`logo`/`font`/`reference`), `storage_key`, `meta jsonb` |
| `channels` | `id`, `org_id`, `brand_id`, `platform`, `handle`, `goal jsonb`, `format_rules jsonb`, `allowed_types text[]`, `language` |
| `personas` | `id`, `org_id`, `name`, `dna jsonb`, `primary_image_id`, `lora_url?`, `image_model`, `video_model` |
| `persona_images` | `id`, `org_id`, `persona_id`, `storage_key`, `is_primary` |
| `plan_items` | `id`, `org_id`, `brand_id`, `channel_id`, `date`, `type`, `topic`, `prompt?`, `text?`, `slides jsonb?`, `notes?`, `source` (`import`/`ai`/`manual`), `import_id?` |
| `imports` | `id`, `org_id`, `brand_id`, `filename`, `mapping jsonb`, `rows_total`, `rows_ok`, `rows_skipped`, `errors jsonb` |
| `format_presets` | `id`, `key` (unique, e.g. `ig_story`), `platform`, `placement`, `width`, `height`, `aspect`, `media` (`image`/`video`/`both`), `max_bytes`, `video_min_s?`, `video_max_s?`, `safe_zone jsonb` (top/right/bottom/left px), `copy_limits jsonb`, `enabled` — global, super admin edits, seeded by migration |
| `platform_rules` | `id`, `platform`, `post_type?`, `caption_max`, `visible_chars?`, `hashtags_max?`, `mentions_max?`, `links_clickable bool`, `thread_part_max?`, `slides_max?`, `counting` (`graphemes`/`x_weighted`), `meta jsonb`, `enabled` — global, super admin edits, seeded by migration |
| `competitors` | `id`, `org_id`, `brand_id`, `name`, `website?`, `handles jsonb`, `source` (`ai`/`manual`), `reason?`, `archived_at?` |
| `competitor_items` | `id`, `org_id`, `competitor_id`, `kind` (`web_page`/`ad`/`post`/`upload`), `url?`, `storage_key?`, `text?`, `public_metrics jsonb?`, `embedding vector(N)`, `collected_at` |
| `competitor_reports` | `id`, `org_id`, `brand_id`, `analysis jsonb`, `learnings jsonb` (adopt/reject items with evidence + owner decision), `gaps jsonb`, `proposal_id?`, `created_at` |
| `ad_sets` | `id`, `org_id`, `brand_id`, `name`, `platforms text[]`, `objective`, `offer`, `landing_url`, `cta`, `preset_keys text[]`, `status` |
| `posts` | `id`, `org_id`, `brand_id`, `channel_id?` (null for ads), `ad_set_id?`, `plan_item_id?`, `profile_version_id`, `type` (`text`/`single_image`/`carousel`/`animation`/`video`/`ad`), `preset_key`, `status`, `content jsonb` (caption / parts / slides), `hashtags text[]`, `rule_failures jsonb`, `topic_summary`, `embedding vector(N)`, `pillar`, `published_at?`, `published_url?` |
| `post_assets` | `id`, `org_id`, `post_id`, `kind` (`image`/`image_clean`/`slide`/`pdf`/`video`/`video_clean`/`poster`/`background`), `position`, `preset_key`, `variant?`, `storage_key`, `width`, `height`, `duration_ms?`, `bytes`, `source_asset_id?` (animation/recompose lineage), `model?`, `prompt?` |
| `generation_jobs` | `id`, `org_id`, `post_id`, `step`, `provider`, `model`, `external_id?`, `status`, `attempts`, `error?`, `cost_micro_usd bigint`, timestamps |
| `usage_ledger` | `id`, `org_id`, `brand_id?`, `job_id?`, `provider`, `model`, `units`, `cost_micro_usd bigint`, `created_at` |
| `model_registry` | `id`, `provider`, `model_key`, `kind`, `unit`, `price_micro_usd bigint`, `default_params jsonb`, `enabled` (global, super admin only) |
| `carousel_templates` | `id`, `org_id?` (null = global), `name`, `definition jsonb` |
| `audit_log` | `id`, `actor_user_id`, `org_id?`, `action`, `target`, `meta jsonb`, `created_at` |

Indexes: `org_id` on every tenant table; `posts (brand_id, created_at)`; HNSW index on `posts.embedding` (cosine);
unique `plan_items (brand_id, channel_id, date, topic)` for import de-duplication.

Money: always `bigint` micro-USD; display rounding only in the UI.

---

## 5. Generation pipeline

Job chain per post (pg-boss, singleton key `post:<id>:<step>` for idempotency):

1. `post.text` — assemble prompt (§6) → Claude → zod-validate JSON → machine rule check → one fix attempt → save content.
2. `post.memory` — topic summary + embedding → similarity check (§7) → save; mark warnings.
3. `post.assets` — fan out `asset.image` / `asset.video` jobs (submitted to fal queue with `webhookUrl`).
4. Webhook `/api/webhooks/fal` — verify fal signature → download result into S3 → mark asset done → when all done enqueue `post.render`.
5. `post.render` — Satori slides / overlays → PNG → PDF (LinkedIn) → `status = ready` (or `needs_review`).

- Sweeper every 2 min: fal jobs pending > 5 min are polled; > 30 min → failed.
- Retries: 2 with exponential backoff for provider errors; validation errors do not retry blindly.
- Cost: estimate from `model_registry` before submit (cap check), actual cost recorded after, one `usage_ledger` row per call.
- Spend cap check is done inside a transaction with a row lock on `org_settings` to avoid races between parallel jobs.
- Every rendered asset is validated against its `format_presets` row (exact width × height, bytes, duration) before `ready`.
- "Clean" assets (`image_clean`, `video_clean`) are kept without overlays so text edits, animation and recompose never re-generate.

### 5.1 Brand ingestion jobs
1. `source.extract` (per source) — by kind (see §1 Brand ingestion); store `extract`; images also get palette (sharp stats) and a vision description.
   Sources are wrapped as quoted data in every prompt; instructions inside them are ignored (prompt-injection guard, tested with a fixture).
2. `brand.synthesize` — when all sources of a batch are extracted: Claude gets the current profile (if any) + extracts → returns
   zod-validated `{fields, source_refs, conflicts, plan_like_sources}` → `brand_profile_proposals` row.
3. Owner accepts in UI → new `brand_profile_versions` row; confirmed assets copied to `brand_assets`.
4. Phase 2: `source.chunk` → `brand_knowledge_chunks` with embeddings; generation retrieves top-k by post topic.

### 5.1a Rule engine (all post types)
- `src/server/rules/` — pure functions: `effectiveRules(platformRules, channelRules, brandRules)` (most strict wins) and
  `check(output, rules)` → list of violations `{rule, actual, limit}`. Platform-accurate counters (X weighted counting via `twitter-text`).
- Used in three places: prompt assembly (limits in the prompt), after generation (auto-fix once), and in the editor (live counters, same code on the client).
- Unit-tested at exact boundaries (limit, limit−1, limit+1, emoji, URLs, diacritics).

### 5.1b Competitor research jobs
- `competitors.find` — Claude with the web search tool + CGP → candidate list (zod) → owner confirms.
- `competitors.collect` — per competitor: web fetch of site/blog (SSRF guard), Meta Ad Library API (needs `META_AD_LIBRARY_TOKEN`), owner uploads via vision.
  No login-based scraping. Stored as `competitor_items` (+ embeddings).
- `competitors.analyze` — Claude over items + CGP → `competitor_reports` (analysis, adopt/reject learnings with evidence, gaps).
- Owner decisions → `brand_profile_proposals` (ADR-018) and brand rules. Ideas from gaps → §6.2 suggestions.
- No-copy check: generated posts compared with `competitor_items.embedding` of the same brand; ≥ 0.85 → warning.

### 5.2 Animation / video jobs
- `asset.animate` — clean image (recomposed to target preset if aspect differs) → fal image-to-video → S3 `video_clean` → `asset.burn` (ffmpeg overlay text/logo/subtitles, transcode to preset) → `video` + `poster`.
- `video.shots` (multi-shot) — one `asset.video` per shot → `video.stitch` (ffmpeg concat) → `asset.burn`.
- ffmpeg runs only in the worker; jobs have a 15 min timeout and are idempotent per `post:<id>:<step>`.

### 5.3 Ads
- `adset.copy` — Claude writes N copy variants with per-platform fields; limits from `format_presets.copy_limits`; machine-checked.
- `adset.visual` — key visual (largest aspect) → `asset.recompose` per preset (smart crop or fal outpaint) → `post.render` per preset × variant with the aspect-family template.
- Export builds `copy.csv` + folders per placement.

---

## 6. Prompt assembly

```
system:
  [Postaja base prompt — fixed, versioned in repo]
  [Brand CGP — profile version N]           ← cached (Anthropic prompt caching)
  [Brand rules + pillars + examples]        ← cached
  [Channel format rules + language]
  [Post-type instructions + JSON schema]
  [Recent topics to avoid — last 60 summaries]
user:
  [Plan item: date, topic, prompt, text, notes] or [ad hoc request]
```

Persona posts add the DNA block and scene description; passport images go to the image model as reference URLs (presigned), never into the LLM.

---

## 7. No-repeat

- Embedding of `topic_summary + caption`, stored in `posts.embedding`.
- Query: nearest neighbours within the same `brand_id`, last 180 days, statuses `ready|approved|published`.
- Thresholds from `org_settings.repeat_thresholds` (defaults: reject ≥ 0.90, warn ≥ 0.82).
- Embedding dimension depends on ADR-008; migration fixes `vector(N)` once decided.

---

## 8. Rendering

- Templates (single image overlay, carousel, ad, video overlay) are React components limited to the Satori subset (flexbox, no grid), parameterised by brand tokens (colors, fonts, logo, spacing).
- Templates exist per aspect family (9:16, 4:5, 1:1, 1.91:1/16:9, banner); they read the preset's `safe_zone` and never place text outside it.
- Sizes come only from `format_presets`; no hard-coded dimensions in feature code. Video overlays are rendered as transparent PNGs by the same templates and composited by ffmpeg.
- Fonts loaded from S3 and cached in the worker; glyph coverage for Slovenian diacritics checked on upload.
- Snapshot tests: render each template with a diacritics fixture and compare against stored PNGs (pixel tolerance).

---

## 9. Environments and deploy

| Env | Host | Notes |
|---|---|---|
| local | docker compose: Postgres+pgvector, MinIO (S3 stand-in) | `pnpm dev` + `pnpm worker` |
| dev | Hetzner CX22 (shared at start), `dev-postaja.inzenirji.si` | auto-deploy on merge to `dev` |
| uat | same VM, separate Kamal destination + DB | when there is a second user |
| prod | separate Hetzner VM (or the same CX at start, decided before launch), `postaja.inzenirji.si` | manual deploy from `main` |

Worker sizing: video + LibreOffice need RAM; start on CX32 (8 GB) for the host running `worker`, or move `worker` to its own VM when video load grows.

- Kamal destinations: `deploy.dev.yml`, `deploy.uat.yml`, `deploy.prod.yml`. Secrets via `.kamal/secrets` reading from the environment (CI secret store), never committed.
- Health endpoint `/api/health` returns the deployed SHA and DB connectivity.
- Migrations run at container start of the `web` role (ADR-024), backward compatible (expand → migrate → contract).
- Backups: nightly `pg_dump` to a separate Object Storage bucket (30 days) + Hetzner server snapshots. Restore drill before prod launch.
- Object Storage buckets per environment.

---

## 10. Environment variables (names only)

```
DATABASE_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL
APP_URL
ANTHROPIC_API_KEY
EMBEDDINGS_PROVIDER / EMBEDDINGS_API_KEY
FAL_KEY
META_AD_LIBRARY_TOKEN        # competitor ads (phase 1b)
S3_ENDPOINT / S3_REGION / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
EMAIL_PROVIDER_API_KEY / EMAIL_FROM
SUPERADMIN_EMAILS            # bootstrap only: these emails get role superadmin on first login
SENTRY_DSN                   # optional
```

---

## 11. Security

- Server-side validation of all input (zod); identity, org and role only from the session.
- Rate limits: auth routes, generation routes, webhook route.
- fal webhook: signature verification, unknown `external_id` rejected, idempotent processing.
- Uploads: size limits, MIME sniffing, fonts parsed and validated, images re-encoded by `sharp`.
- Brand sources: office files processed only in the worker, LibreOffice in a sandboxed process without network; macros never executed; zip-bomb limits on DOCX/XLSX/PPTX.
- URL sources: server-side fetch with SSRF guard (no private IPs, no redirects to them), size and time limits.
- Prompt injection: source content always passed as quoted data; synthesis output is a proposal the owner must accept.
- No prompts, captions, emails or tokens in logs beyond IDs; provider errors logged without payloads.
- BYOK keys (phase 2): encrypted at rest (AES-GCM, key from env), never returned to the client.

---

## 12. CI (GitHub Actions)

Per `DEVELOPMENT-RULES.md` §5: frozen install → lint → typecheck → unit → migrate test DB (Postgres+pgvector service) →
integration (incl. cross-tenant suite) → build → Playwright + axe → render snapshot tests → Docker build.
Deploy workflow: on merge to `dev` → build image → push GHCR → `kamal deploy -d dev` → smoke check (health SHA, main page 200).
