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
(Commands become valid once TASK-001 is merged.)

## Repo / environments
| Env | URL | Deploys from | Status |
|---|---|---|---|
| local | http://localhost:3000 | working tree | Planned (TASK-001) |
| dev | https://dev-postaja.inzenirji.si | `dev` (auto) | Planned (TASK-002) |
| prod | https://postaja.inzenirji.si | `main` (manual) | Planned |

## Done
- 2026-10-05: product spec v0.2, architecture v0.2, ADR-001…024, manifest, brand identity (logo), brand CGP template.

## Owner's open actions
1. GitHub → `DataVallis/postaja` → Settings → General → Default branch → **dev**.
2. GitHub → Settings → Branches → protect `dev` and `main`: require PR + status check **CI** to pass.
3. For TASK-002 (first deploy), prepare:
   - Hetzner Cloud VM (CX32, Ubuntu 24.04) with your SSH key; send the **IP** (not keys).
   - DNS: `A dev-postaja.inzenirji.si → <IP>`.
   - Docker on the VM is installed by Kamal; port 22/80/443 open only.

## Parked ideas
- Showcase on aibuilders.si as a "built with vibe coding" case.

## Next
TASK-001 — `docs/tasks/TASK-001-scaffold.md` (in progress).
Latest numbers: TASK-006 (planned list), ADR-024.

## Open items
- ADR-008 embedding provider (Open).
- Default fal models per post type — test round after TASK-006.
