# TASK-002 feedback
Status: **PARTIAL** — Postaja is live on dev; waiting for owner: `DEPLOY_DEV_ENABLED=true`, asisto check, rollback drill.

## What was done
- Owner: Hetzner Cloud Firewall (22/80/443 + ICMP) — asisto 5432/6379/3000 no longer reachable (owner's `nc` timed out).
- Owner: DNS `dev-postaja.inzenirji.si` and `postaja.inzenirji.si` A → 91.99.191.8 (Cloudflare proxy off).
- Owner: GitHub environment `dev` (DEPLOY_SSH_KEY, DEV_SSH_KNOWN_HOSTS, POSTGRES_PASSWORD, DATABASE_URL), variable DEV_HOST.
- Owner: nginx block `ops/nginx/dev-postaja.inzenirji.si.conf` + certbot. `nginx -t` ok; certificate issued, expires 2027-01-03, auto-renew scheduled.
  Pre-existing warning (not ours): `protocol options redefined for [::]:443 in /etc/nginx/sites-enabled/asisto-portal:45`.
- Agent: triggered **Deploy dev** manually with `setup=true` on `dev` @ 8445e2d — run 37334467728, job 111845619800:
  Install Kamal, SSH key, **First-time setup** (proxy boot_config 127.0.0.1:8080/8443 + `kamal setup -d dev`), **Smoke check** — all `success`.

## Proof (this session)
```
2026-10-05T17:41 — GET https://dev-postaja.inzenirji.si/api/health
{"status":"ok","sha":"8445e2df0a0b3211f666e3566b9a2b67ef8bf82b","db":"ok"}
```
SHA = merge commit of PR #4 on `dev`. The workflow's smoke check also asserted `/` = 200.

## NOT RUN
- Agent-side checks of asisto domains and port 8080 — NOT RUN: the agent sandbox cannot open arbitrary outbound connections (proxy 403). Owner checks below.
- Rollback drill — needs a second deployed version; after the next merge: `kamal app containers -d dev` → `kamal rollback <previous> -d dev`.

## Owner checks still open
1. GitHub → Settings → Secrets and variables → Actions → Variables → `DEPLOY_DEV_ENABLED` = `true`.
2. Browser: asisto.app, portal.asisto.app and api.asisto.app work as before.
3. Laptop: `nc -zv -w3 91.99.191.8 8080` → must time out.
