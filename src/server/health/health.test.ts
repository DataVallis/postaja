import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../db/client";
import { buildSha, checkHealth } from "./health";

const fakeDb = (execute: () => Promise<unknown>) => (() => ({ execute }) as unknown as Db);

afterEach(() => vi.unstubAllEnvs());

describe("buildSha", () => {
  it("uses GIT_SHA when set", () => {
    vi.stubEnv("GIT_SHA", "abc123");
    expect(buildSha()).toBe("abc123");
  });
  it("falls back to dev when unset or blank", () => {
    vi.stubEnv("GIT_SHA", "  ");
    expect(buildSha()).toBe("dev");
  });
});

describe("checkHealth", () => {
  it("200 when the DB answers", async () => {
    const r = await checkHealth(fakeDb(async () => [{ "?column?": 1 }]));
    expect(r).toEqual({ code: 200, body: { status: "ok", sha: "dev", db: "ok" } });
  });
  it("503 without error details when the DB throws", async () => {
    const r = await checkHealth(fakeDb(async () => { throw new Error("password authentication failed for user x"); }));
    expect(r.code).toBe(503);
    expect(r.body).toEqual({ status: "error", sha: "dev", db: "error" });
  });
  it("503 when getDb itself throws (missing DATABASE_URL)", async () => {
    const r = await checkHealth(() => { throw new Error("DATABASE_URL is not set"); });
    expect(r.code).toBe(503);
  });
  it("503 when the DB hangs longer than the timeout", async () => {
    const r = await checkHealth(fakeDb(() => new Promise(() => {})), 50);
    expect(r.code).toBe(503);
  });
});
