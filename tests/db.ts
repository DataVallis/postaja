import postgres from "postgres";
import { runMigrations } from "@/server/db/migrate";

/** Drops everything in the test DB and applies all migrations. Integration tests only. */
export async function resetAndMigrate(url: string) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP EXTENSION IF EXISTS vector;");
  } finally {
    await sql.end({ timeout: 5 });
  }
  await runMigrations(url);
}
