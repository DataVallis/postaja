// Backup naming, retention keys, pg_dump environment and the production-only switch (TASK-030, ADR-063).
import { describe, expect, it } from "vitest";
import { backupConfigFromEnv, backupKey, backupTime, pgEnv } from "./service";

const full = {
  BACKUP_ENABLED: "1", BACKUP_S3_ENDPOINT: "https://fsn1.your-objectstorage.com", BACKUP_S3_BUCKET: "postaja-backup",
  BACKUP_S3_ACCESS_KEY_ID: "k", BACKUP_S3_SECRET_ACCESS_KEY: "s",
};

describe("backups", () => {
  it("are on only with BACKUP_ENABLED=1 and every BACKUP_S3_* value (production config)", () => {
    expect(backupConfigFromEnv({})).toBeNull();
    expect(backupConfigFromEnv({ ...full, BACKUP_ENABLED: "0" })).toBeNull();
    expect(backupConfigFromEnv({ ...full, BACKUP_S3_BUCKET: "" })).toBeNull();
    // The app's own storage variables never switch backups on.
    expect(backupConfigFromEnv({ S3_ENDPOINT: "x", S3_BUCKET: "postaja-dev", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" })).toBeNull();
    expect(backupConfigFromEnv(full)).toMatchObject({ bucket: "postaja-backup", region: "fsn1", retentionDays: 30, forcePathStyle: false });
    expect(backupConfigFromEnv({ ...full, BACKUP_RETENTION_DAYS: "14" })!.retentionDays).toBe(14);
  });

  it("names a backup by its UTC time and reads the time back; other keys are ignored", () => {
    const at = new Date("2026-10-08T00:15:07.123Z");
    const key = backupKey(at);
    expect(key).toBe("postgres/2026/10/postaja-20261008T001507Z.dump");
    expect(backupTime(key)).toEqual(new Date("2026-10-08T00:15:07Z"));
    expect(backupTime("postgres/readme.txt")).toBeNull();
  });

  it("passes the connection to pg_dump as libpq variables, the password never on the command line", () => {
    expect(pgEnv("postgres://postaja:p%40ss@postaja-db:5432/postaja_prod?sslmode=require")).toEqual({
      PGHOST: "postaja-db", PGPORT: "5432", PGDATABASE: "postaja_prod", PGUSER: "postaja", PGPASSWORD: "p@ss", PGSSLMODE: "require",
    });
  });
});
