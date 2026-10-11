// Production backups (TASK-030, ADR-063) against a real Postgres and the S3 stand-in: pg_dump → upload → list →
// a restore into an empty database has the data; retention removes old copies but always keeps the newest few.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CreateBucketCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetAndMigrate } from "../../../tests/db";
import { backupKey, listBackups, pgEnv, pruneBackups, runBackup, type BackupConfig } from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const restoreDb = "postaja_restore_test";
const restoreUrl = (() => { const u = new URL(url); u.pathname = `/${restoreDb}`; return u.toString(); })();
const cfg: BackupConfig = {
  endpoint: process.env.S3_ENDPOINT!, region: process.env.S3_REGION || "us-east-1", bucket: `postaja-backup-test-${Date.now()}`,
  accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!, forcePathStyle: true, retentionDays: 30,
};
const s3 = new S3Client({ endpoint: cfg.endpoint, region: cfg.region, forcePathStyle: true, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } });

beforeAll(async () => {
  await resetAndMigrate(url);
  await s3.send(new CreateBucketCommand({ Bucket: cfg.bucket }));
  await sql.unsafe(`drop database if exists ${restoreDb}`);
  await sql.unsafe(`create database ${restoreDb}`);
});
afterAll(async () => {
  await sql.unsafe(`drop database if exists ${restoreDb} with (force)`);
  await sql.end({ timeout: 5 });
});

describe("database backups", () => {
  it("dump → bucket → restore: an empty database gets the data back", async () => {
    const id = crypto.randomUUID();
    await sql`insert into organization (id, name, slug, created_at) values (${id}, 'Backup Test', ${`backup-${id.slice(0, 8)}`}, now())`;
    const now = new Date("2026-10-08T00:15:00Z");
    const r = await runBackup(cfg, url, now);
    expect(r.key).toBe(backupKey(now));
    expect(r.bytes).toBeGreaterThan(1000);
    expect((await listBackups(cfg)).map((b) => b.key)).toEqual([r.key]);

    const obj = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: r.key }));
    const dir = mkdtempSync(path.join(tmpdir(), "restore-"));
    try {
      const file = path.join(dir, "db.dump");
      writeFileSync(file, await obj.Body!.transformToByteArray());
      const restore = spawnSync(process.env.PG_RESTORE_PATH || "pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", `--dbname=${restoreDb}`, file], {
        env: { ...process.env, ...pgEnv(restoreUrl) }, encoding: "utf8",
      });
      expect(restore.stderr).toBe("");
      expect(restore.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const back = postgres(restoreUrl, { max: 1, onnotice: () => {} });
    try {
      expect((await back`select name from organization where id = ${id}`).map((x) => x.name)).toEqual(["Backup Test"]);
      expect((await back`select count(*)::int as n from drizzle.__drizzle_migrations`)[0].n).toBeGreaterThan(30);
    } finally {
      await back.end({ timeout: 5 });
    }
  });

  it("retention: older than 30 days goes, but the newest seven always stay; other files are left alone", async () => {
    const now = new Date("2026-10-08T00:15:00Z");
    const day = 86_400_000;
    const put = (k: string) => s3.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: k, Body: "x" }));
    for (const d of [1, 2, 3, 40, 41, 90]) await put(backupKey(new Date(now.getTime() - d * day)));
    await put("postgres/notes.txt");
    // 7 backups in all (incl. the one above): the old ones are among the newest seven, so nothing goes.
    expect(await pruneBackups(cfg, now)).toBe(0);
    for (const d of [4, 5, 6, 7]) await put(backupKey(new Date(now.getTime() - d * day)));
    expect(await pruneBackups(cfg, now)).toBe(3);
    const left = await listBackups(cfg);
    expect(left).toHaveLength(8);
    expect(left.every((b) => now.getTime() - b.at.getTime() <= 30 * day)).toBe(true);
    expect(await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: "postgres/notes.txt" })).then(() => true)).toBe(true);
  });
});
