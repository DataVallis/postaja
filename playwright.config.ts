import { defineConfig, devices } from "@playwright/test";

import path from "node:path";

const PORT = Number(process.env.E2E_PORT ?? 3100);
export const MAIL_DIR = path.resolve("test-results/mail");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  // On CI the GitHub reporter also writes failures as annotations, readable through the API when logs are not.
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Optional override for environments with a preinstalled Chromium (CI installs its own).
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [{
    // Anthropic API stand-in (tests/e2e/mock-anthropic.mjs); reached via the SDK's ANTHROPIC_BASE_URL.
    command: "node tests/e2e/mock-anthropic.mjs",
    port: 3199,
    reuseExistingServer: false,
  }, {
    command: `PORT=${PORT} HOSTNAME=127.0.0.1 ./scripts/start-standalone.sh`,
    env: {
      BETTER_AUTH_URL: `http://127.0.0.1:${PORT}`,
      BETTER_AUTH_SECRET: "e2e-only-secret-e2e-only-secret-0123456789",
      SUPERADMIN_EMAILS: "e2e-admin@example.test,e2e-root@example.test",
      // E2E signs in many times per minute from one IP; servers keep the default of 5.
      AUTH_MAGIC_LINK_RATE_MAX: "1000",
      EMAIL_TRANSPORT: "file",
      MAIL_DIR: MAIL_DIR,
      ANTHROPIC_API_KEY: "e2e-not-a-real-key",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:3199",
      // fal.ai stand-in (same mock server) for AI image backgrounds (TASK-015).
      FAL_KEY: "e2e-not-a-real-key",
      FAL_BASE_URL: "http://127.0.0.1:3199",
      // Bulk creation runs in the background (ADR-042): the E2E server runs the workers too.
      RUN_WORKER: "1",
    },
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  }],
});
