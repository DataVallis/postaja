import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Ads (TASK-021): an ad concept for Meta and Google, copy written per network within its limits, edited, checked, exported.
const MAIL_DIR = path.resolve("test-results/mail");
function latestLinkTo(email: string): string | undefined {
  if (!fs.existsSync(MAIL_DIR)) return undefined;
  for (const f of fs.readdirSync(MAIL_DIR).sort().reverse()) {
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

test("ads: Claude writes copy per network within its limits; the owner edits, the copy is checked, copy.csv", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one full flow is enough");
  test.setTimeout(90_000);
  const stamp = Date.now();
  const owner = `oglasi-${stamp}@example.test`;
  await signIn(page, "e2e-root@example.test");
  await page.goto("/admin/orgs/new");
  await page.getByLabel("Ime", { exact: true }).fill("Oglasi E2E");
  await page.getByLabel("Kratko ime (slug)").fill(`oglasi-${stamp}`);
  await page.getByLabel("E-pošta lastnika").fill(owner);
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: "Oglasi E2E" })).toBeVisible();

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await signIn(p, owner);
  await p.goto("/app/brands/new");
  await p.getByLabel("Ime", { exact: true }).fill("Tečaj");
  await p.getByRole("button", { name: "Ustvari" }).click();
  await expect(p.getByRole("heading", { name: "Tečaj", level: 1 })).toBeVisible();
  await p.getByRole("navigation", { name: "Razdelki branda" }).getByRole("link", { name: "Oglasi" }).click();
  const form = p.getByTestId("ad-form");
  await form.getByLabel("Cilj", { exact: true }).selectOption("leads");
  await form.getByLabel("Ciljna stran").fill("tecaj.si/prijava");
  await form.getByLabel("Ponudba").fill("Brezplačen webinar v četrtek");
  await form.getByLabel("Google Display (responsive)").check();
  await form.getByLabel(/Story \/ Reels · 1080×1920/).uncheck();
  expect(await serious(p)).toEqual([]);
  await form.getByRole("button", { name: "Ustvari oglas" }).click();

  await expect(p).toHaveURL(/\/app\/ads\/[^/]+$/);
  await expect(p.getByTestId("ad-status")).toHaveText("pripravljen");
  await expect(p.getByTestId("ad-placements")).not.toContainText("Story");
  await expect(p.getByTestId("ad-placements")).toContainText("Google Display (responsive): Odzivni 1200×628, Odzivni 1200×1200");
  const v1 = p.getByTestId("variant-1");
  await expect(v1.getByLabel("Naslov", { exact: true })).toHaveValue("Naslov 1");
  await expect(v1.getByLabel("Kratki naslovi")).toHaveValue("Naslov 1a\nNaslov 1b");
  await expect(v1.getByLabel("Gumb (CTA)")).toHaveValue("Learn More");
  await expect(p.getByTestId("variant-3")).toBeVisible();
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("ad-set.png"), fullPage: true });

  // An over-long Meta headline is caught on save; fixing it makes the ad ready again.
  await v1.getByLabel("Naslov", { exact: true }).fill("x".repeat(45));
  await p.getByRole("button", { name: "Shrani besedila" }).click();
  await expect(p.getByTestId("ad-status")).toHaveText("za pregled");
  await expect(p.getByTestId("ad-issues")).toContainText("1 polje krši pravila");
  await expect(p.getByTestId("variant-1")).toContainText("Predolgo: 45 od največ 40 znakov.");
  await p.getByTestId("variant-1").getByLabel("Naslov", { exact: true }).fill("Prijavi se na webinar");
  await p.getByRole("button", { name: "Shrani besedila" }).click();
  await expect(p.getByTestId("ad-status")).toHaveText("pripravljen");

  // copy.csv for the ad managers: Meta feed 4:5 + 1:1 and Google 1.91:1 + 1:1, three variants each.
  const [csv] = await Promise.all([p.waitForEvent("download"), p.getByTestId("ad-csv").click()]);
  expect(csv.suggestedFilename()).toMatch(/-copy\.csv$/);
  const lines = fs.readFileSync((await csv.path())!, "utf8").replace(/^\uFEFF/, "").trim().split("\r\n");
  expect(lines).toHaveLength(1 + 4 * 3);
  expect(lines.find((l) => l.includes(";meta;fb_feed_portrait;1080;1350;1;"))).toContain("Prijavi se na webinar");

  // Back on the brand: the ad set in the list.
  await p.getByRole("link", { name: /Tečaj · Oglasi/ }).click();
  await expect(p.getByTestId("ad-sets")).toContainText("Brezplačen webinar v četrtek");
  await ctx.close();
});
