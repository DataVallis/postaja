export default function setup() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL is not set — integration tests need a real Postgres (see docs/HANDOFF.md Bootstrap).");
  }
}
