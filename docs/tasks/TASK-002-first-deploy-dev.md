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
- Follow-up check: **host nginx is active on 80/443** (proxies the asisto API domain to `localhost:3000`); 7.6 GB RAM (6.4 GB available), 35 GB disk free, no swap; `deploy` is in `docker` and `sudo`.
- Redis has **no password** and was reachable from the internet; `dir=/data`, `dbfilename=dump.rdb` (no sign of the known config-rewrite abuse).
- Decision: ADR-026 (kamal-proxy takes 80/443) was **superseded by ADR-027** after reading the asisto repo: `asisto.app` and
  `portal.asisto.app` are Laravel on host PHP-FPM. Host nginx stays the edge; kamal-proxy listens on 127.0.0.1:8080 behind it.
- Firewall (Step A) done 2026-10-05: 5432/6379/3000 now time out from outside. DNS `dev-postaja` and `postaja` A → 91.99.191.8 (Cloudflare proxy off) done.

## Plan (in this order)
### Step A — close the open ports (owner, today, reversible)
Hetzner Console → Firewalls → Create: inbound TCP 22, 80, 443 + ICMP only → apply to the server.
Docker-published ports bypass ufw, so the cloud firewall is the reliable fix. nginx reaches the API via localhost, so asisto keeps working.
Verify from your laptop: `nc -zv -w3 91.99.191.8 5432; nc -zv -w3 91.99.191.8 6379; nc -zv -w3 91.99.191.8 3000` → all must fail.

### Step B — swap (owner, 1 min)
```
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Step C — GitHub environment `dev` (owner, guided)
See "Owner steps" 3–4 below. Nothing on the server changes yet.

### Step D — nginx block + TLS for dev-postaja (owner, ~3 min, no effect on asisto)
```
# on the server, from a checkout or by pasting the file content of ops/nginx/dev-postaja.inzenirji.si.conf
sudo nano /etc/nginx/sites-available/dev-postaja.inzenirji.si.conf
sudo ln -s ../sites-available/dev-postaja.inzenirji.si.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d dev-postaja.inzenirji.si
```
Until Step E the site answers 502 (nothing on 8080 yet) — expected.

### Step E — first deploy (agent triggers, owner watches)
GitHub → Actions → **Deploy dev** → Run workflow → branch `dev`, **setup = true**.
It sets kamal-proxy to `127.0.0.1:8080/8443`, boots `postaja-db`, deploys the app, then smoke-checks https://dev-postaja.inzenirji.si/api/health.
Then repo variable `DEPLOY_DEV_ENABLED=true` → every merge to `dev` deploys.

## Owner steps (agent never touches the server or secrets)
1. **Check the shared server** (run on the server as `deploy`, paste output — no secrets in it):
   ```
   ss -tln | grep -E ':(80|443)\b'          # no sudo needed; empty output = ports free
   systemctl is-active nginx caddy apache2   # "inactive" for all = no host web server
   groups deploy; free -h; df -h /
   ```
   - Done 2026-10-05 — see results above and the plan (Steps A–D).
   - `deploy` must be in the `docker` group (`groups deploy`).
2. **DNS**: `A dev-postaja.inzenirji.si → 91.99.191.8` — done.
3. **Deploy key**: on your machine `ssh-keygen -t ed25519 -f postaja_deploy -C postaja-ci` → add `postaja_deploy.pub` to `~deploy/.ssh/authorized_keys` on the server.
   Pinned host key: `ssh-keyscan -t ed25519 91.99.191.8`.
4. **GitHub** (DataVallis/postaja → Settings):
   - Environments → new environment `dev` → secrets `DEPLOY_SSH_KEY` (private key), `DEV_SSH_KNOWN_HOSTS` (keyscan line),
     `POSTGRES_PASSWORD` (long random), `DATABASE_URL` (`postgres://postaja:<same password>@postaja-db:5432/postaja_dev`).
   - Actions → Variables → `DEV_HOST` = `91.99.191.8`.
   - Packages: after the first push, set the `postaja` package visibility/access so the server can pull (Kamal logs in with the registry credentials, so private is fine).
5. Steps D and E above.

## Agent steps
- Review the server check output and confirm the plan for ports 80/443 before step 5.
- After the first deploy: verify the Deploy run for the merge SHA, open the health URL, flip `app-skeleton.md` status to **Live on dev**, update HANDOFF.

## Acceptance criteria
- `curl https://dev-postaja.inzenirji.si/api/health` → `{"status":"ok","sha":"<merge sha>","db":"ok"}`; `/` = 200 with valid TLS (certbot).
- `asisto.app`, `portal.asisto.app`, `api.asisto.app` still answer as before.
- kamal-proxy is not reachable from outside (`nc -zv -w3 91.99.191.8 8080` times out).
- The existing app on the server still works (owner confirms its URL).
- Postgres is not reachable from outside (`nc -zv 91.99.191.8 5432` fails).
- Rollback practised once: `kamal rollback <previous version> -d dev`, output pasted.
