# Cheat sheet (owner)

Never values here — only names and where they live.

## URLs
| What | URL |
|---|---|
| Repo | https://github.com/DataVallis/postaja |
| dev | https://dev-postaja.inzenirji.si (after TASK-002) |
| dev health | https://dev-postaja.inzenirji.si/api/health → `"status":"ok"` and `"sha"` = last merged commit |
| prod | https://postaja.inzenirji.si (later) |

## Hosts
| Env | Host | SSH user | Notes |
|---|---|---|---|
| dev | Hetzner VM `asisto-api-prod` (IP in GitHub variable `DEV_HOST`) | `deploy` | shared with asisto and later volil.si; host nginx → kamal-proxy 127.0.0.1:8080 (ADR-027); Hetzner Cloud Firewall 22/80/443 |

## Secrets and variables (GitHub → Settings → Environments → `dev` / Variables)
| Name | Kind | Where | Used by |
|---|---|---|---|
| `DEPLOY_DEV_ENABLED` | repo variable | Settings → Secrets and variables → Actions → Variables | turns on deploy-dev workflow (`true`) |
| `DEV_HOST` | repo variable | same | Kamal server address |
| `DEPLOY_SSH_KEY` | env `dev` secret | Environments → dev | CI → server SSH (dedicated deploy key) |
| `DEV_SSH_KNOWN_HOSTS` | env `dev` secret | Environments → dev | pinned host key (`ssh-keyscan -t ed25519 <host>`) |
| `POSTGRES_PASSWORD` | env `dev` secret | Environments → dev | DB accessory |
| `DATABASE_URL` | env `dev` secret | Environments → dev | app → `postgres://postaja:<POSTGRES_PASSWORD>@postaja-db:5432/postaja_dev` |
| `BETTER_AUTH_SECRET` | env `dev` secret | Environments → dev | signs sessions (`openssl rand -base64 32`) |
| `SMTP_PASSWORD` | env `dev` secret | Environments → dev | password of hello@inzenirji.si on mail.datavallis.com |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | env `dev` secret | Environments → dev | Hetzner Object Storage, bucket `postaja-dev`, endpoint `https://fsn1.your-objectstorage.com` |
| `ANTHROPIC_API_KEY` | env `dev` secret | Environments → dev | post generation (Claude API key, console.anthropic.com) |
| `SUPERADMIN_EMAILS` | repo variable | Actions → Variables | emails that may bootstrap as super admin (comma separated) |
| `GITHUB_TOKEN` | automatic | — | push image to GHCR |

### Production only (when the production environment is set up)
| Name | Kind | Where | Used by |
|---|---|---|---|
| `BACKUP_ENABLED` | env `production` variable (`1`) | Environments → production | turns on nightly database backups (TASK-030) |
| `BACKUP_S3_ENDPOINT` / `BACKUP_S3_BUCKET` | env `production` variables | Environments → production | `https://fsn1.your-objectstorage.com`, `postaja-backup` |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | env `production` secrets | Environments → production | Hetzner Object Storage keys for `postaja-backup` only (separate from the app bucket keys) |

Keep your own copy of every secret (GitHub never shows it again).

## Commands (owner's machine, with the env vars above exported)
| Task | Command |
|---|---|
| Deploy dev manually | `kamal deploy -d dev` |
| Logs | `kamal app logs -d dev -f` |
| **Rollback** | `kamal app containers -d dev` (find previous version) → `kamal rollback <version> -d dev` |
| DB shell | `kamal accessory exec db -d dev --interactive --reuse "psql -U postaja postaja_dev"` |
| Start DB accessory first time | `kamal accessory boot db -d dev` |
| First setup via CI | Actions → Deploy dev → Run workflow → setup = true |
| nginx block for dev | `ops/nginx/dev-postaja.inzenirji.si.conf` (+ `sudo certbot --nginx -d dev-postaja.inzenirji.si`) |
