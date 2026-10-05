import { sql } from "drizzle-orm";
import type { Db } from "../db/client";

export type Health = { status: "ok" | "error"; sha: string; db: "ok" | "error" };

export function buildSha(): string {
  return process.env.GIT_SHA?.trim() || "dev";
}

/** Checks DB connectivity with a bounded timeout. Never exposes error details. */
export async function checkHealth(getDb: () => Db, timeoutMs = 3000): Promise<{ code: 200 | 503; body: Health }> {
  const sha = buildSha();
  try {
    const db = getDb();
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    return { code: 200, body: { status: "ok", sha, db: "ok" } };
  } catch {
    return { code: 503, body: { status: "error", sha, db: "error" } };
  }
}
