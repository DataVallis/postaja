// Node.js-only startup work (ADR-024): apply migrations before serving traffic.
export async function runStartupMigrations() {
  if (process.env.RUN_MIGRATIONS !== "1") return;
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[migrate] DATABASE_URL is not set");
    process.exit(1);
  }
  const { runMigrations } = await import("./server/db/migrate");
  try {
    await runMigrations(url);
    console.log("[migrate] done");
  } catch (err) {
    console.error("[migrate] failed:", err instanceof Error ? err.message : "unknown error");
    process.exit(1);
  }
}

/** Background workers (ADR-042) in this process when RUN_WORKER=1; a failure is logged, the web keeps serving. */
export async function startBackgroundWorkers() {
  if (process.env.RUN_WORKER !== "1") return;
  try {
    const { startWorkers } = await import("./server/jobs/worker");
    await startWorkers();
  } catch (err) {
    console.error("[jobs] workers not started:", err instanceof Error ? err.message : "unknown error");
  }
}
