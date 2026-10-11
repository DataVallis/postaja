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

// Demo from a website (TASK-040): a super admin enters a prospect's site (here unreachable, so its text is pasted);
// the demo is built in the background in the sales org; the prospect opens the link without an account and sees the
// brand, three posts with images and the ad; the super admin opens the brand in the app and revokes the link.
test("demo from a website: built in the sales org, shown through a read-only link that can be revoked", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one flow is enough");
  test.setTimeout(240_000);
  await signIn(page, "e2e-root@example.test");
  await page.goto("/admin/demos");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Demo iz spletne strani");
  const form = page.getByTestId("demo-form");
  await form.getByLabel("Spletna stran").fill("https://pekarna-soncek.invalid");
  await form.getByLabel("Ime branda (neobvezno)").fill("Pekarna Sonček");
  await form.getByText("Strani ni mogoče prebrati? Prilepi besedilo").click();
  await form.getByLabel("Besedilo s spletne strani").fill("Pekarna Sonček v Kranju peče domač kruh, pecivo in potice vsak dan od šestih zjutraj. Naročila za praznike sprejemamo po telefonu.");
  await form.getByRole("button", { name: "Ustvari demo" }).click();
  const link = await page.getByTestId("demo-new-link").getByRole("textbox").inputValue();
  expect(link).toMatch(/\/d\/[A-Za-z0-9_-]{40,}$/);
  expect(await serious(page)).toEqual([]);

  // Built in the background; the list refreshes itself.
  const row = page.getByTestId("demo-row").filter({ hasText: "pekarna-soncek.invalid" }).first();
  await expect(row).toContainText("Pripravljen", { timeout: 180_000 });
  await expect(row).toContainText("Ni uspelo: SITE:NETWORK");

  // The prospect: no account, no menu.
  const prospect = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const c = await prospect.newPage();
  await c.goto(link);
  await expect(c.getByRole("heading", { level: 1 })).toHaveText("Pekarna Sonček na Postaji");
  await expect(c.getByRole("navigation", { name: "Glavna navigacija" })).toHaveCount(0);
  await expect(c.getByTestId("demo-post")).toHaveCount(3);
  await expect(c.getByTestId("demo-post").first().getByRole("img")).toHaveCount(1);
  await expect(c.getByTestId("demo-post").nth(1).getByRole("img")).toHaveCount(4);
  await expect(c.getByTestId("demo-ad")).toContainText("Naslov 1");
  const first = await c.getByTestId("demo-post").first().getByRole("img").getAttribute("src");
  expect((await c.request.get(first!, { maxRedirects: 0 })).status()).toBe(302);
  expect(await serious(c)).toEqual([]);
  await c.screenshot({ path: info.outputPath("demo.png"), fullPage: true });

  // The super admin opens the demo brand in the app (switched to the sales organization).
  await row.getByRole("button", { name: "Odpri brand" }).click();
  await expect(page).toHaveURL(/\/app\/brands\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Pekarna Sonček");

  // Revoked: the link says so, and its pictures are gone too.
  await page.goto("/admin/demos");
  await page.getByTestId("demo-row").filter({ hasText: "pekarna-soncek.invalid" }).first().getByRole("button", { name: "Prekliči povezavo" }).click();
  await expect(page.getByTestId("demo-row").filter({ hasText: "pekarna-soncek.invalid" }).first()).toContainText("povezava preklicana");
  await c.goto(link);
  await expect(c.getByRole("heading", { level: 1 })).toHaveText("Povezava ne velja več");
  expect((await c.request.get(first!, { maxRedirects: 0 })).status()).toBe(404);
  await prospect.close();
});
