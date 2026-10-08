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
async function signIn(page: Page, email: string) {
  const before = latestLinkTo(email);
  await page.goto("/login");
  await page.getByLabel("E-pošta").fill(email);
  await page.getByRole("button", { name: "Pošlji povezavo" }).click();
  await expect.poll(() => latestLinkTo(email), { timeout: 10_000 }).not.toBe(before);
  await page.goto(latestLinkTo(email)!);
  await expect(page).toHaveURL(/\/app$/);
}
const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.target}`);


// Credits (TASK-038): the super admin gives an org 0 monthly credits → the owner sees "used up" everywhere, asks for a
// pack → the super admin grants it once paid → the owner has 500 credits; prices are edited in /admin/credits.
test("credits: allowance from the admin, banner, pack request and grant, price list", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one flow is enough");
  test.setTimeout(120_000);
  const stamp = Date.now();
  const owner = `krediti-${stamp}@example.test`;
  await signIn(page, "e2e-root@example.test");
  await page.goto("/admin/orgs/new");
  await page.getByLabel("Ime", { exact: true }).fill(`Krediti E2E ${stamp}`);
  await page.getByLabel("Kratko ime (slug)").fill(`krediti-${stamp}`);
  await page.getByLabel("E-pošta lastnika").fill(owner);
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: `Krediti E2E ${stamp}` })).toBeVisible();
  await page.getByLabel("Krediti na mesec").fill("0");
  await page.getByRole("button", { name: "Shrani" }).click();
  await expect(page.getByText("Shranjeno").first()).toBeVisible();
  await expect(page.getByTestId("org-credits")).toContainText("na voljo 0");

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await signIn(p, owner);
  await expect(p.getByTestId("credit-banner")).toContainText("Krediti tega meseca so porabljeni.");
  await p.getByTestId("credit-banner").getByRole("link", { name: "Kupi kredite" }).click();
  await expect(p).toHaveURL(/\/app\/team/);
  await p.getByRole("button", { name: "500 za 25 €" }).click();
  await expect(p.getByRole("status").filter({ hasText: "Zahteva za kredite je poslana." })).toBeVisible();
  await expect(p.getByTestId("credit-request-list")).toContainText("čaka na plačilo");
  expect(await serious(p)).toEqual([]);

  await page.goto("/admin");
  await expect(page.getByTestId("credit-requests-banner")).toBeVisible();
  await page.goto("/admin/credits");
  const req = page.getByTestId("credit-requests").locator("div", { hasText: `Krediti E2E ${stamp}` }).first();
  await req.getByRole("button", { name: "Plačano – dodeli" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Krediti so dodeljeni." })).toBeVisible();
  expect(await serious(page)).toEqual([]);

  await p.goto("/app/team");
  await expect(p.getByTestId("credit-banner")).toHaveCount(0);
  await expect(p.getByTestId("team-credits")).toContainText("500");
  await expect(p.getByTestId("credit-request-list")).toContainText("dodano");

  // Prices: the super admin raises text to 2 and puts it back.
  await page.getByTestId("credit-prices").getByLabel("Besedilo objave / oglasni copy").fill("2");
  await page.getByRole("button", { name: "Shrani cenik" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cenik je shranjen." })).toBeVisible();
  await expect(page.getByTestId("credit-prices").getByLabel("Besedilo objave / oglasni copy")).toHaveValue("2");
  await page.getByTestId("credit-prices").getByLabel("Besedilo objave / oglasni copy").fill("1");
  await page.getByRole("button", { name: "Shrani cenik" }).click();
  await ctx.close();
});
