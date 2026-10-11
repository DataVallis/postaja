import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./client";
import { runMigrations } from "./migrate";
import { checkHealth } from "../health/health";

const url = process.env.TEST_DATABASE_URL!;
const journal = JSON.parse(fs.readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8"));
const MIGRATIONS = journal.entries.length as number;
const admin = postgres(url, { max: 1, onnotice: () => {} });

async function resetDb() {
  await admin.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP EXTENSION IF EXISTS vector;");
}

beforeAll(resetDb);
afterAll(async () => { await admin.end({ timeout: 5 }); });

describe("migrations", () => {
  it("apply from zero and enable pgvector", async () => {
    expect(MIGRATIONS).toBeGreaterThanOrEqual(2);
    const before = await admin`select count(*)::int as n from pg_extension where extname = 'vector'`;
    expect(before[0].n).toBe(0);
    await runMigrations(url);
    const after = await admin`select count(*)::int as n from pg_extension where extname = 'vector'`;
    expect(after[0].n).toBe(1);
    const applied = await admin`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(applied[0].n).toBe(MIGRATIONS);
  });

  it("are idempotent (second run applies nothing)", async () => {
    await runMigrations(url);
    const applied = await admin`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(applied[0].n).toBe(MIGRATIONS);
  });

  it("vector type works after migration", async () => {
    const r = await admin`select ('[1,0]'::vector <=> '[0,1]'::vector) as d`;
    expect(Number(r[0].d)).toBeCloseTo(1, 5);
  });
});

describe("health against a real DB", () => {
  it("200 with a reachable DB", async () => {
    const db = createDb(url, { max: 1 });
    const r = await checkHealth(() => db);
    expect(r.code).toBe(200);
    expect(r.body.db).toBe("ok");
  });
  it("503 with an unreachable DB", async () => {
    const db = createDb("postgres://nobody:wrong@127.0.0.1:1/none", { max: 1 });
    const r = await checkHealth(() => db, 3000);
    expect(r.code).toBe(503);
    expect(r.body).toEqual({ status: "error", sha: r.body.sha, db: "error" });
  });
});
