// Runs once per server start. Node-only code lives in instrumentation-node.ts so it is never bundled for Edge.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runStartupMigrations } = await import("./instrumentation-node");
    await runStartupMigrations();
  }
}
