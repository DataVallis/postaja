# Handoff — state as of 2026-10-05

## Working mode
**Mode B (autonomous) — partially.** Owner granted push access to `DataVallis/postaja` on 2026-10-05
("tukaj pa maš git, sem ti dal dostop … začni").
- Agent may: create `feat/*`, `fix/*`, `docs/*` branches, push them, open PRs to `dev`.
- Merging to `dev`: **owner merges** until he confirms "agent may merge green PRs to dev" (then record it here with date and words).
- Agent never: touches `uat`/`main`, servers, DNS, secrets, GitHub settings.
- Ask the owner only for: keys/secrets, accounts, server actions, product decisions, uat/prod, irreversible steps.

## Git and CI specifics
- Default branch should be `dev` (owner action, see below). `main` = production releases only.
- Bootstrap exception: the repo was empty; the first docs commit was pushed directly to `main` and `dev` was created from it.
  From now on everything goes through PRs.
- Waiting for CI: one polling command every ~30 s.

## Bootstrap a fresh session
```
git clone https://github.com/DataVallis/postaja && cd postaja && git checkout dev
corepack enable && pnpm install --frozen-lockfile
cp .env.example .env            # fill local values only
docker compose up -d            # Postgres+pgvector (5432), MinIO (9000/9001)
pnpm db:migrate && pnpm dev     # http://localhost:3000
pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm test:e2e
```
No Docker Hub access in some agent sandboxes: run Postgres 16 + pgvector natively and set `TEST_DATABASE_URL`;
for E2E with a preinstalled Chromium set `PW_CHROMIUM_PATH`.

## Repo / environments
| Env | URL | Deploys from | Status |
|---|---|---|---|
| local | http://localhost:3000 | working tree | Built (TASK-001) |
| dev | https://dev-postaja.inzenirji.si | `dev` (auto) | Planned (TASK-002) |
| prod | https://postaja.inzenirji.si | `main` (manual) | Planned |

## Done
- 2026-10-05: product spec v0.2, architecture v0.2, ADR-001…025, manifest, brand identity (logo), brand CGP template.
- 2026-10-05: TASK-001 scaffold — PR `feat/TASK-001-scaffold` → `dev`.

## Owner's open actions
1. GitHub → `DataVallis/postaja` → Settings → General → Default branch → **dev**.
2. GitHub → Settings → Branches → protect `dev` and `main`: require PR + status check **CI** to pass.
3. TASK-002 owner steps — `docs/tasks/TASK-002-first-deploy-dev.md` (server check first: are ports 80/443 already taken by the existing app?).

## Parked ideas
- Showcase on aibuilders.si as a "built with vibe coding" case.

## Next
TASK-002 — first deploy to dev (owner steps), then TASK-003 auth + orgs.
Latest numbers: TASK-006 (planned list), ADR-025.

## Servers
- dev: Hetzner VM 91.99.191.8, user `deploy`, 4 vCPU / 8 GB / 80 GB. Shared: an existing app (must keep running) and later volil.si (ADR-025).

## Open items
- ADR-008 embedding provider (Open).
- Default fal models per post type — test round after TASK-006.
