import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const MAIL_DIR = path.resolve("test-results/mail");
function latestLinkTo(email: string): string | undefined {
  if (!fs.existsSync(MAIL_DIR)) return undefined;
  for (const f of fs.readdirSync(MAIL_DIR).filter((f) => f.endsWith(".json")).sort().reverse()) {
    const m = JSON.parse(fs.readFileSync(path.join(MAIL_DIR, f), "utf8"));
    if (m.to === email && m.subject.includes("Prijava")) return m.text.match(/https?:\/\/\S+/)![0];
  }
}
const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.target}`);

// Self-serve signup (TASK-037): from the login page to a trial organization — the email link, confirming the name, the
// trial banner, the first steps on the dashboard (the first brand ticks one off), the trial on the team page.
test("signup: a 7-day trial from the login page; first steps on the dashboard", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one flow is enough");
  test.setTimeout(90_000);
  const stamp = Date.now();
  const email = `trial-${stamp}@example.test`;
  await page.goto("/login");
  await page.getByRole("link", { name: "Preizkusi Postajo brezplačno" }).click();
  await expect(page.getByText("Preizkusi Postajo 7 dni brezplačno")).toBeVisible();
  expect(await serious(page)).toEqual([]);
  await page.getByLabel("Ime podjetja ali agencije").fill(`Pekarna ${stamp}`);
  await page.getByLabel("E-pošta").fill(email);
  await page.getByRole("button", { name: "Pošlji povezavo za začetek" }).click();
  await expect(page.getByTestId("signup-sent")).toBeVisible();
  await expect.poll(() => latestLinkTo(email), { timeout: 10_000 }).toBeTruthy();

  await page.goto(latestLinkTo(email)!);
  await expect(page).toHaveURL(/\/app\/start$/);
  await expect(page.getByLabel("Ime podjetja ali agencije")).toHaveValue(`Pekarna ${stamp}`);
  expect(await serious(page)).toEqual([]);
  await page.getByRole("button", { name: "Začni 7-dnevni preizkus" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("trial-banner")).toContainText("Preizkus traja še 7 dni");
  const steps = page.getByTestId("first-steps");
  await expect(steps).toContainText("Narejeno 0 od 5.");
  expect(await serious(page)).toEqual([]);

  await steps.getByRole("link", { name: "1. Dodaj brand" }).click();
  await page.getByLabel("Ime", { exact: true }).fill("Pekarna");
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: "Nastavitev branda" })).toBeVisible();
  await page.goto("/app");
  await expect(page.getByTestId("first-step-brand")).toHaveAttribute("data-done", "1");
  await expect(page.getByTestId("first-steps")).toContainText("Narejeno 1 od 5.");
  await expect(page.getByTestId("first-step-cgp").getByRole("link", { name: "2. Vpiši CGP" })).toHaveAttribute("href", /\/setup\?step=cgp$/);

  await page.goto("/app/team");
  await expect(page.getByTestId("billing-state")).toContainText("Brezplačni preizkus velja do");
  await expect(page.getByTestId("team-usage")).toContainText("1 / 1");

  // The link to start again no longer creates anything: the signed-in owner goes to the dashboard.
  await page.goto("/app/start");
  await expect(page).toHaveURL(/\/app$/);
});
