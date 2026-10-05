# App skeleton

Status: **Live on dev** — https://dev-postaja.inzenirji.si (since 2026-10-05, first deploy 8445e2d).

## Runtime
- Next.js 16 (App Router, Turbopack build), React 19, TypeScript strict, `output: "standalone"`.
- Production server = `.next/standalone/server.js` (the Docker image and E2E both run exactly this).

## UI, tokens, i18n
- Brand tokens are CSS variables in `src/app/globals.css` (`--color-ink`, `--color-signal`, `--color-paper`, …) exposed to Tailwind via `@theme inline`. Dark mode follows `prefers-color-scheme`.
- Inter is self-hosted (`src/app/fonts/*.woff2`, Latin + Latin Extended incl. č š ž ć đ) through `next/font/local` — no Google requests.
- next-intl without locale routing: locale from cookie `NEXT_LOCALE` (`sl` default, `en`), messages in `messages/<locale>.json`. A unit test enforces identical keys in both files.

## Database and migrations
- Drizzle ORM + `postgres` driver. `getDb()` (`src/server/db/client.ts`) throws if `DATABASE_URL` is missing.
- Migrations live in `drizzle/` (SQL + journal). `0000_enable_pgvector` = `CREATE EXTENSION IF NOT EXISTS vector`.
- **Production** (ADR-024): `src/instrumentation.ts` runs once at server start; with `RUN_MIGRATIONS=1` it applies pending migrations and exits the process (code 1) on failure, so the new container never becomes healthy and kamal-proxy keeps the old one.
- **Local**: `pnpm db:migrate` (drizzle-kit). New schema change: edit `src/server/db/schema.ts` → `pnpm db:generate` → commit the SQL.

## Health
`GET /api/health` → `200 {"status":"ok","sha":"<GIT_SHA>","db":"ok"}` or `503 {"status":"error",…,"db":"error"}`.
DB check is `select 1` with a 3 s timeout; no error details are returned. `GIT_SHA` is baked in at image build (`--build-arg GIT_SHA`).

## Tests
| Command | What | Needs |
|---|---|---|
| `pnpm test` | unit (`src/**/*.test.ts`) | — |
| `pnpm test:int` | integration (`src/**/*.int.test.ts`) on real Postgres: migrations from zero, idempotency, pgvector, health 200/503 | `TEST_DATABASE_URL` (missing = suite fails) |
| `pnpm test:e2e` | Playwright + axe on the standalone server, desktop + mobile, light + dark | `pnpm build` first, `DATABASE_URL`; `PW_CHROMIUM_PATH` optional |

## Docker
Multi-stage (`deps` → `build` → `runner`), runs as uid 1001, copies standalone output, static, public and `drizzle/`.
`HEALTHCHECK` calls `/api/health`. Base image overridable with `--build-arg NODE_IMAGE=…`.

## CI (`.github/workflows/ci.yml`)
Job **CI**: frozen install → lint → typecheck → unit → integration (pgvector service) → build → E2E + axe → Docker build → run container against Postgres, assert health SHA = commit SHA, `db:ok`, uid 1001.
Job **Kamal config**: renders `kamal config -d dev` with placeholder values.

## Deploy (`.github/workflows/deploy-dev.yml`, Kamal 2)
On push to `dev` when repo variable `DEPLOY_DEV_ENABLED=true`, or manually: `kamal deploy -d dev` (builds amd64 image, pushes to GHCR, switches traffic in kamal-proxy) → smoke check (health SHA = pushed SHA, `/` = 200).
Manual run with `setup=true` (first time on a host): `kamal proxy boot_config set --http-port 8080 --https-port 8443 --publish-host-ip 127.0.0.1` + `kamal setup -d dev`.
Edge on the shared dev host (ADR-027): host nginx terminates TLS (certbot) and proxies `dev-postaja.inzenirji.si` to kamal-proxy on `127.0.0.1:8080` (`ops/nginx/dev-postaja.inzenirji.si.conf`); Kamal `proxy.ssl: false`, `forward_headers: true`.
Config: `config/deploy.yml` + `config/deploy.dev.yml`. DB is the accessory `postaja-db` (pgvector/pg16, volume `postaja-dev-db`, no published port, 1 GB memory limit). Shared host rules: ADR-025, ADR-027.
