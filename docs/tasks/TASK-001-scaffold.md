# TASK-001 — Scaffold
Depends on: —
Read first: docs/00-MANIFEST.md, docs/03-DECISIONS.md (ADR-002, 003, 006, 007, 017, 024), docs/02-ARCHITECTURE.md §1, §9, §10, §12, docs/DEVELOPMENT-RULES.md §4–§10

## Goal
An empty but production-shaped Postaja app: runs locally against Postgres+pgvector, passes every CI check,
builds a Docker image, and has Kamal config ready so TASK-002 only needs the server, DNS and secrets.

## Scope
### 1. App
- Next.js (App Router, TypeScript strict), pnpm, Node 22 (`.nvmrc`), `output: "standalone"`.
- Tailwind CSS with Postaja brand tokens as CSS variables (`docs/brand/BRAND.md`); no hard-coded colours in components.
- next-intl with `sl` (default) and `en` messages; locale from cookie, no locale in the URL yet. All UI strings through i18n.
- Home page: logo mark, wordmark "postaja.", one sentence from i18n. Favicon from `mark.svg`.
- `GET /api/health` → `200 {status:"ok", sha, db:"ok"}`; DB down → `503 {status:"error", sha, db:"error"}` (no error details).
  `sha` from `GIT_SHA` env (set at image build), `"dev"` locally.

### 2. Database
- Drizzle ORM + `postgres` driver; `src/server/db/` (client, schema index).
- First migration: `CREATE EXTENSION IF NOT EXISTS vector`. No tables yet.
- `pnpm db:migrate` runs migrations (script usable in the container).

### 3. Local environment
- `docker-compose.yml`: `pgvector/pgvector:pg16` (+ test DB), MinIO. `.env.example` lists every variable (names only).

### 4. Tests
- Vitest unit (`*.test.ts`) and integration (`*.int.test.ts`, real Postgres). Missing `DATABASE_URL` **fails** the integration suite.
- Integration: migrations from zero on an empty DB; `vector` extension present; health handler returns `db:"ok"` against real DB and `503` with an unreachable DB.
- Playwright + axe: home page 200, no serious/critical a11y violations, `/api/health` 200 with `sha`.

### 5. Docker
- Multi-stage Dockerfile, non-root user, standalone output, `GIT_SHA` build arg, `HEALTHCHECK` on `/api/health`.
- Entrypoint runs migrations when `RUN_MIGRATIONS=1`, then starts the server (ADR-024).
- `.dockerignore` excludes `**/node_modules`, build output, `**/.env*`, `.git`.

### 6. CI (GitHub Actions)
- `ci.yml` on PR to `dev`/`main` and push to `dev`: frozen install → lint → typecheck → unit → migrate test DB → integration → build → E2E + axe → Docker build.
- `deploy-dev.yml` on push to `dev`: build + push image to GHCR → `kamal deploy -d dev` → smoke (health SHA = merge SHA, `/` 200).
  Disabled until the repo variable `DEPLOY_DEV_ENABLED == 'true'` (set in TASK-002).

### 7. Kamal
- `config/deploy.yml` + `config/deploy.dev.yml`: service `postaja`, image `ghcr.io/datavallis/postaja`, role `web`,
  kamal-proxy with TLS for `dev-postaja.inzenirji.si`, healthcheck `/api/health`, accessory `db` (pgvector/pg16, volume, not published).
- `.kamal/secrets` reads every secret from the environment only.

## Decisions already made (do not re-decide)
- Stack per ADR-002…007. Migrations at container start (ADR-024). No auth, no worker, no S3 code yet.

## Must not touch
Anything outside the repo; no server, DNS or GitHub settings changes.

## Allowed dependencies
next, react, react-dom, next-intl, tailwindcss (+ its PostCSS plugin), drizzle-orm, drizzle-kit, postgres, zod,
typescript, @types/*, eslint + eslint-config-next, vitest, @playwright/test, @axe-core/playwright — anything else: ask first.

## Acceptance criteria
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm build && pnpm test:e2e` pass locally; outputs pasted.
- Docker image builds and `/api/health` returns 200 with the build SHA from a running container; output pasted.
- Deliberate breaks shown for: integration suite without `DATABASE_URL`, health with DB down.
- CI green on the PR.
- Docs: `docs/technical/README.md` + `docs/technical/app-skeleton.md`, `docs/CHEATSHEET.md`, HANDOFF updated, feedback written.
