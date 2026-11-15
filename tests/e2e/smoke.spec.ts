import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const scheme of ["light", "dark"] as const) {
  test(`home renders with no serious a11y violations (${scheme})`, async ({ page, context, baseURL }) => {
    // Theme comes from the postaja-theme cookie (dark by default, TASK-011), not the OS setting.
    if (scheme === "light") await context.addCookies([{ name: "postaja-theme", value: "light", url: baseURL! }]);
    const res = await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("postaja.");
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);
  });
}

test("english via cookie", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL! }]);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByText("Coming soon.", { exact: true })).toBeVisible();
});

test("health returns ok with sha", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ status: "ok", db: "ok" });
  expect(typeof body.sha).toBe("string");
});

// Terms of use (TASK-060): public, readable without an account, in Slovenian and English.
test("terms of use: public page in both languages", async ({ page, context, baseURL }) => {
  const res = await page.goto("/terms");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Pogoji uporabe" })).toBeVisible();
  await expect(page.getByTestId("terms")).toContainText("Plačila se ne vračajo.");
  await expect(page.getByTestId("terms")).toContainText("izključno poslovnim uporabnikom");
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(13);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL! }]);
  await page.goto("/terms");
  await expect(page.getByRole("heading", { level: 1, name: "Terms of use" })).toBeVisible();
  await expect(page.getByTestId("terms")).toContainText("Payments are not refunded.");
});
