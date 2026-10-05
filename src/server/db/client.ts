import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

export function createDb(url: string, opts: { max?: number } = {}) {
  const sql = postgres(url, { max: opts.max ?? 10, connect_timeout: 5, idle_timeout: 20 });
  return drizzle(sql, { schema });
}

let cached: Db | undefined;

/** Process-wide DB for the running app. Fails loudly when DATABASE_URL is missing. */
export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  cached = createDb(url);
  return cached;
}
