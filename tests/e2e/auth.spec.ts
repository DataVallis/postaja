import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const MAIL_DIR = path.resolve("test-results/mail");

function latestMailTo(email: string): { text: string } | undefined {
  if (!fs.existsSync(MAIL_DIR)) return undefined;
  const files = fs.readdirSync(MAIL_DIR).sort().reverse();
  for (const f of files) {
    const m = JSON.parse(fs.readFileSync(path.join(MAIL_DIR, f), "utf8"));
    if (m.to === email) return m;
  }
}

test("protected page redirects to login", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);
});

test("login page has no serious a11y violations", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("E-pošta")).toBeVisible();
  const r = await new AxeBuilder({ page }).analyze();
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);
});

test("superadmin signs in with a magic link and signs out", async ({ page }, info) => {
  fs.rmSync(MAIL_DIR, { recursive: true, force: true });
  const email = "e2e-admin@example.test";
  await page.goto("/login");
  await page.getByLabel("E-pošta").fill(email);
  await page.getByRole("button", { name: "Pošlji povezavo" }).click();
  await expect(page.getByRole("status")).toContainText("povezavo za prijavo");

  await expect.poll(() => latestMailTo(email), { timeout: 10_000 }).toBeTruthy();
  const link = latestMailTo(email)!.text.match(/https?:\/\/\S+/)![0];
  await page.goto(link);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("user-email")).toHaveText(email);
  await expect(page.getByText(/^Super admin/)).toBeVisible();
  await expect(page.getByTestId("no-org")).toHaveText("Še nisi član nobene organizacije.");
  await page.screenshot({ path: info.outputPath("app-signed-in.png") });

  await page.getByRole("button", { name: "Račun" }).click();
  await page.getByRole("menuitem", { name: "Odjava" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);
});

test("unknown email gets the same message and no mail", async ({ page }) => {
  fs.rmSync(MAIL_DIR, { recursive: true, force: true });
  await page.goto("/login");
  await page.getByLabel("E-pošta").fill("stranger@example.test");
  await page.getByRole("button", { name: "Pošlji povezavo" }).click();
  await expect(page.getByRole("status")).toContainText("povezavo za prijavo");
  await page.waitForTimeout(500);
  expect(latestMailTo("stranger@example.test")).toBeUndefined();
});

test("a used or bad link shows an error on the login page", async ({ page }) => {
  await page.goto("/api/auth/magic-link/verify?token=not-a-real-token&callbackURL=%2Fapp&errorCallbackURL=%2Flogin%3Ferror%3Dlink");
  await expect(page).toHaveURL(/\/login\?error=/);
  await expect(page.getByRole("alert").filter({ hasText: "neveljavna" })).toBeVisible();
});
