# TASK-002 — First deploy to dev
Depends on: TASK-001 (merged)
Read first: docs/CHEATSHEET.md, docs/technical/app-skeleton.md §Deploy, ADR-017, ADR-024, ADR-025

## Goal
`https://dev-postaja.inzenirji.si/api/health` returns `"status":"ok"` with the merged SHA, deployed automatically on every merge to `dev`,
without disturbing the existing app on the shared server.

## Server check — result 2026-10-05 (host `asisto-api-prod`)
| Container | Image | Published ports |
|---|---|---|
| asisto-api | ghcr.io/davidtacer/asisto-api:latest | 0.0.0.0:3000 |
| asisto-laravel | asisto-website-app | none (80, 9000 internal only) |
| asisto-redis | redis:7-alpine | 0.0.0.0:6379 |
| asisto-postgres | postgis/postgis:14-3.3-alpine | 0.0.0.0:5432 |

- No container publishes 80/443, and asisto is not Kamal-managed (docker compose names) → kamal-proxy can likely take 80/443
  **unless a host-level web server (nginx/Caddy/Apache) listens there** — still to confirm (`sudo ss` needed a password).
- No conflict with Postaja: our DB accessory publishes no port, the app port is internal to the `kamal` network.
- Risk (asisto, outside Postaja): 5432, 6379 and 3000 bound to `0.0.0.0` → owner checks Hetzner/ufw firewall (HANDOFF, owner action 1).
- Memory/disk output not captured (command stopped at the sudo prompt).

## Owner steps (agent never touches the server or secrets)
1. **Check the shared server** (run on the server as `deploy`, paste output — no secrets in it):
   ```
   ss -tln | grep -E ':(80|443)\b'          # no sudo needed; empty output = ports free
   systemctl is-active nginx caddy apache2   # "inactive" for all = no host web server
   groups deploy; free -h; df -h /
   ```
   - If ports 80/443 are held by something other than `kamal-proxy` (e.g. nginx, Caddy, Traefik), stop: the CTO proposes how to put the
     existing app behind kamal-proxy or route through the existing proxy. Do not change anything yet.
   - `deploy` must be in the `docker` group (`groups deploy`).
2. **DNS**: `A dev-postaja.inzenirji.si → 91.99.191.8`.
3. **Deploy key**: on your machine `ssh-keygen -t ed25519 -f postaja_deploy -C postaja-ci` → add `postaja_deploy.pub` to `~deploy/.ssh/authorized_keys` on the server.
   Pinned host key: `ssh-keyscan -t ed25519 91.99.191.8`.
4. **GitHub** (DataVallis/postaja → Settings):
   - Environments → new environment `dev` → secrets `DEPLOY_SSH_KEY` (private key), `DEV_SSH_KNOWN_HOSTS` (keyscan line),
     `POSTGRES_PASSWORD` (long random), `DATABASE_URL` (`postgres://postaja:<same password>@postaja-db:5432/postaja_dev`).
   - Actions → Variables → `DEV_HOST` = `91.99.191.8`.
   - Packages: after the first push, set the `postaja` package visibility/access so the server can pull (Kamal logs in with the registry credentials, so private is fine).
5. **First boot** (from your machine with Kamal 2 installed and the same env vars exported, or let CI do it):
   `kamal setup -d dev` once (installs/joins kamal-proxy, boots `postaja-db`, deploys the app).
6. Set variable `DEPLOY_DEV_ENABLED=true` → every merge to `dev` deploys.

## Agent steps
- Review the server check output and confirm the plan for ports 80/443 before step 5.
- After the first deploy: verify the Deploy run for the merge SHA, open the health URL, flip `app-skeleton.md` status to **Live on dev**, update HANDOFF.

## Acceptance criteria
- `curl https://dev-postaja.inzenirji.si/api/health` → `{"status":"ok","sha":"<merge sha>","db":"ok"}`; `/` = 200 with valid TLS.
- The existing app on the server still works (owner confirms its URL).
- Postgres is not reachable from outside (`nc -zv 91.99.191.8 5432` fails).
- Rollback practised once: `kamal rollback <previous version> -d dev`, output pasted.
