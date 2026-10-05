import { defineConfig, devices } from "@playwright/test";

import path from "node:path";

const PORT = Number(process.env.E2E_PORT ?? 3100);
export const MAIL_DIR = path.resolve("test-results/mail");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Optional override for environments with a preinstalled Chromium (CI installs its own).
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `PORT=${PORT} HOSTNAME=127.0.0.1 ./scripts/start-standalone.sh`,
    env: {
      BETTER_AUTH_URL: `http://127.0.0.1:${PORT}`,
      BETTER_AUTH_SECRET: "e2e-only-secret-e2e-only-secret-0123456789",
      SUPERADMIN_EMAILS: "e2e-admin@example.test",
      EMAIL_TRANSPORT: "file",
      MAIL_DIR: MAIL_DIR,
    },
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
