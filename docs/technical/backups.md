# Database backups (TASK-030, ADR-063)

Production data only (owner, 2026-10-08: "backupamo samo produkcijske podatke, te na dev ne rabimo backupat").

## What
- Every night at 02:15 Europe/Ljubljana the worker runs `pg_dump --format=custom --compress=6 --no-owner
  --no-privileges` of the app database and uploads it to bucket **`postaja-backup`** at
  `https://fsn1.your-objectstorage.com` as `postgres/<yyyy>/<mm>/postaja-<UTC time>.dump`.
- Retention: copies older than 30 days (`BACKUP_RETENTION_DAYS`) are deleted, but the newest 7 always stay. Other files
  in the bucket are never touched.
- Super admin → **Varnostne kopije** (`/admin/backups`): on/off, bucket, the copies (time, file, size), *Naredi kopijo
  zdaj* (queued, audited as `backup.run`).
- Not included: files in the app bucket (images, videos, uploads). Recommended (owner, server action): turn on
  versioning on the production app bucket.

## Switch (production config only)
Backups run only when `BACKUP_ENABLED=1` **and** all of `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`,
`BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` are set (optional `BACKUP_S3_REGION` default `fsn1`,
`BACKUP_RETENTION_DAYS` default 30, `BACKUP_S3_FORCE_PATH_STYLE`). Dev, uat and tests never set them; there the worker
removes any leftover schedule and the admin page says backups are off. The app's own `S3_*` variables never switch
backups on, so a backup can never land in the dev bucket.

## How
- `src/server/backup/service.ts`: `backupConfigFromEnv`, `runBackup` (dump to a private temp dir → `PutObject` →
  `pruneBackups`), `listBackups`, `pgEnv`. The password reaches `pg_dump` through `PGPASSWORD` in its environment, never
  the command line; stderr is truncated in errors. 30-minute timeout.
- Worker (`src/server/jobs/worker.ts`): queue `db-backup`, pg-boss cron `15 2 * * *` (tz Europe/Ljubljana), 2 retries
  10 minutes apart. Logs `[backup] <key> <bytes> bytes, <n> old removed`.
- Image: `postgresql-client-16` from the PostgreSQL apt repository (bookworm ships 15, which refuses a 16 server);
  `PG_DUMP_PATH=/usr/lib/postgresql/16/bin/pg_dump`. CI checks the version inside the built image.

## Restore (runbook)
1. Pick the copy in `/admin/backups` (or list `postgres/` in the bucket) and download it with the backup bucket keys.
2. Restore into an **empty** database first, never over production:
   `createdb postaja_restore && pg_restore --no-owner --no-privileges --exit-on-error --dbname=postaja_restore <file>.dump`
3. Check it (organizations, latest posts, `drizzle.__drizzle_migrations`), then switch the app's `DATABASE_URL` to it or
   copy what was lost. Switching production is an owner decision.

## Tests
`service.test.ts` (on only with every production variable, never from the app's `S3_*`; key naming and time; libpq
variables), `backup.int.test.ts` (real `pg_dump` → S3 stand-in → `pg_restore` into an empty database has the data and
the migration history; retention deletes only old copies beyond the newest seven, leaves other files), E2E
`admin.spec.ts` (outside production the page shows backups off, no manual run).
