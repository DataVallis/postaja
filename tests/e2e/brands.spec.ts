import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
const tab = (p: Page, name: string) => p.getByRole("navigation", { name: "Razdelki branda" }).getByRole("link", { name }).click();

const MAIL_DIR = path.resolve("test-results/mail");
function latestLinkTo(email: string): string | undefined {
  if (!fs.existsSync(MAIL_DIR)) return undefined;
  for (const f of fs.readdirSync(MAIL_DIR).filter((f) => f.endsWith(".json")).sort().reverse()) {
    const m = JSON.parse(fs.readFileSync(path.join(MAIL_DIR, f), "utf8"));
    if (m.to === email && m.subject.includes("Prijava")) return m.text.match(/https?:\/\/\S+/)![0];
  }
}
async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-pošta").fill(email);
  await page.getByRole("button", { name: "Pošlji povezavo" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect.poll(() => latestLinkTo(email), { timeout: 10_000 }).toBeTruthy();
  await page.goto(latestLinkTo(email)!);
  await expect(page).toHaveURL(/\/app$/);
}
const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);

test("owner creates a brand, saves CGP versions, adds a channel and sees the effective rules", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one full flow is enough");
  const stamp = Date.now();
  const owner = `brand-owner-${stamp}@example.test`;

  // Super admin prepares an organization with an invited owner.
  await signIn(page, "e2e-root@example.test");
  await page.goto("/admin/orgs/new");
  await page.getByLabel("Ime", { exact: true }).fill("Brandi E2E");
  await page.getByLabel("Kratko ime (slug)").fill(`brandi-${stamp}`);
  await page.getByLabel("E-pošta lastnika").fill(owner);
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: "Brandi E2E" })).toBeVisible();

  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await signIn(p, owner);
  await p.getByRole("link", { name: "Brandi" }).click();
  await expect(p.getByText("Še nimaš brandov. Ustvari prvega.")).toBeVisible();
  await p.getByRole("link", { name: "Nov brand" }).click();
  await p.getByLabel("Ime", { exact: true }).fill("Inženirji");
  await p.getByLabel("Kratko ime (slug)").fill("inzenirji");
  await p.getByLabel("Spletna stran").fill("https://inzenirji.si");
  expect(await serious(p)).toEqual([]);
  await p.getByRole("button", { name: "Ustvari" }).click();

  await expect(p.getByRole("heading", { name: "Inženirji", level: 1 })).toBeVisible();
  await expect(p.getByText("verzija 1")).toBeVisible();
  await tab(p, "Profil (CGP)");
  await p.getByLabel("CGP — navodila za AI").fill("# Inženirji\nPišemo jasno, strokovno, brez žargona. Čšž.");
  await p.getByLabel("Stebri vsebine").fill("Nasveti | 60 | praktični nasveti\nZgodbe | 40");
  await p.getByLabel("Največ hashtagov", { exact: true }).fill("4");
  await p.getByRole("button", { name: "Shrani novo verzijo" }).click();
  await expect(p.getByRole("status").filter({ hasText: "Shranjeno kot verzija 2." })).toBeVisible();

  await p.getByLabel("Stebri vsebine").fill("Nasveti | 70\nZgodbe | 40");
  await p.getByRole("button", { name: "Shrani novo verzijo" }).click();
  await expect(p.getByRole("alert").filter({ hasText: "Preveri vnesene podatke." })).toBeVisible();

  await tab(p, "Kanali");
  await p.getByLabel("Platforma").selectOption("instagram");
  await p.getByLabel("Profil (@ime)").fill("@inzenirji");
  await p.getByLabel("Privzeti format").selectOption("ig_feed_portrait");
  await p.getByLabel("Največ hashtagov na kanalu").fill("3");
  await p.getByRole("button", { name: "Dodaj kanal" }).click();
  await expect(p.getByTestId("channels")).toContainText("instagram · @inzenirji");
  // platform 5, brand 4, channel 3 → 3; Instagram: 2200 chars, links not clickable
  await expect(p.getByTestId("effective-instagram")).toHaveText("Velja: 2200 znakov · 3 hashtagov · povezave niso klikljive");
  await tab(p, "Verzije");
  await expect(p.getByTestId("versions")).toContainText("v2");
  await expect(p.getByTestId("versions")).toContainText("ustvarjen");
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("brand.png"), fullPage: true });
  await ctx.close();
});
