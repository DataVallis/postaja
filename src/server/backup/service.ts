// Database backups (TASK-030, ADR-063): a nightly `pg_dump` (custom format, compressed) of the **production** database
// to its own Object Storage bucket, kept for 30 days. Owner (2026-10-08): only production data is backed up, never dev
// — so backups run only where BACKUP_ENABLED=1 and the BACKUP_S3_* variables are set (production config only).
// The dump goes to a private temp file and is uploaded; the database password reaches pg_dump through its environment,
// never the command line.
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export const BACKUP_QUEUE = "db-backup";
export const BACKUP_PREFIX = "postgres/";
export const RETENTION_DAYS = 30;

export type BackupConfig = { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean; retentionDays: number };

/** The backup target, or null when backups are off (dev, uat, tests): BACKUP_ENABLED=1 and every BACKUP_S3_* value. */
export function backupConfigFromEnv(env: Record<string, string | undefined> = process.env): BackupConfig | null {
  if (env.BACKUP_ENABLED !== "1") return null;
  const need = ["BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"] as const;
  if (need.some((k) => !env[k])) return null;
  return {
    endpoint: env.BACKUP_S3_ENDPOINT!, region: env.BACKUP_S3_REGION || "fsn1", bucket: env.BACKUP_S3_BUCKET!,
    accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID!, secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY!,
    forcePathStyle: env.BACKUP_S3_FORCE_PATH_STYLE === "1", retentionDays: Number(env.BACKUP_RETENTION_DAYS) > 0 ? Number(env.BACKUP_RETENTION_DAYS) : RETENTION_DAYS,
  };
}

const client = (c: BackupConfig) => new S3Client({ endpoint: c.endpoint, region: c.region, forcePathStyle: c.forcePathStyle, credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey } });

/** `postgres/2026/10/postaja-20261008T021500Z.dump` — the time in the name drives retention. */
export function backupKey(now: Date): string {
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${BACKUP_PREFIX}${iso.slice(0, 4)}/${iso.slice(4, 6)}/postaja-${iso}.dump`;
}

/** When a backup key was made (from its name), or null for anything else in the bucket. */
export function backupTime(key: string): Date | null {
  const m = key.match(/postaja-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.dump$/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}

/** pg_dump connection settings from DATABASE_URL, as libpq environment variables. */
export function pgEnv(databaseUrl: string): Record<string, string> {
  const u = new URL(databaseUrl);
  return {
    PGHOST: u.hostname, PGPORT: u.port || "5432", PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
    PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password),
    ...(u.searchParams.get("sslmode") ? { PGSSLMODE: u.searchParams.get("sslmode")! } : {}),
  };
}

function run(bin: string, args: string[], env: Record<string, string>, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"], env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env } as unknown as NodeJS.ProcessEnv });
    let err = "";
    child.stderr!.on("data", (d: Buffer) => { if (err.length < 4000) err += d; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${path.basename(bin)}: timeout`)); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${path.basename(bin)} exited ${code}: ${err.slice(-500)}`)); });
  });
}

/** Dumps the database and uploads it; then removes backups older than the retention. Returns the new key and size. */
export async function runBackup(cfg: BackupConfig, databaseUrl: string, now = new Date()): Promise<{ key: string; bytes: number; deleted: number }> {
  const dir = await mkdtemp(path.join(tmpdir(), "postaja-backup-"));
  try {
    const file = path.join(dir, "db.dump");
    await run(process.env.PG_DUMP_PATH || "pg_dump", ["--format=custom", "--compress=6", "--no-owner", "--no-privileges", `--file=${file}`], pgEnv(databaseUrl), 30 * 60_000);
    const { size } = await stat(file);
    const key = backupKey(now);
    const s3 = client(cfg);
    await s3.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: createReadStream(file), ContentLength: size, ContentType: "application/octet-stream" }));
    const deleted = await pruneBackups(cfg, now);
    return { key, bytes: size, deleted };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Every backup in the bucket, newest first. */
export async function listBackups(cfg: BackupConfig): Promise<{ key: string; bytes: number; at: Date }[]> {
  const s3 = client(cfg);
  const out: { key: string; bytes: number; at: Date }[] = [];
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: BACKUP_PREFIX, ContinuationToken: token }));
    for (const o of r.Contents ?? []) {
      const at = o.Key ? backupTime(o.Key) : null;
      if (o.Key && at) out.push({ key: o.Key, bytes: o.Size ?? 0, at });
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Deletes backups older than the retention, but always keeps the newest few. */
export async function pruneBackups(cfg: BackupConfig, now = new Date(), keepAtLeast = 7): Promise<number> {
  const all = await listBackups(cfg);
  const cutoff = now.getTime() - cfg.retentionDays * 86_400_000;
  const old = all.slice(keepAtLeast).filter((b) => b.at.getTime() < cutoff);
  if (!old.length) return 0;
  await client(cfg).send(new DeleteObjectsCommand({ Bucket: cfg.bucket, Delete: { Objects: old.map((b) => ({ Key: b.key })) } }));
  return old.length;
}
