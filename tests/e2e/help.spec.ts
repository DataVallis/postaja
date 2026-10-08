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

// User guide (TASK-026): reachable from the menu, chapters with sections, links between chapters, accessible.
test("help: the user guide from the menu, a chapter, its sections and the next chapter", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one flow is enough");
  const stamp = Date.now();
  const owner = `pomoc-${stamp}@example.test`;
  await signIn(page, "e2e-root@example.test");
  await page.goto("/admin/orgs/new");
  await page.getByLabel("Ime", { exact: true }).fill("Pomoč E2E");
  await page.getByLabel("Kratko ime (slug)").fill(`pomoc-${stamp}`);
  await page.getByLabel("E-pošta lastnika").fill(owner);
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: "Pomoč E2E" })).toBeVisible();

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await signIn(p, owner);
  await p.getByRole("navigation", { name: "Glavna navigacija" }).getByRole("link", { name: "Navodila za uporabo" }).click();
  await expect(p.getByRole("heading", { name: "Navodila za uporabo", level: 1 })).toBeVisible();
  const chapters = p.getByTestId("help-chapters").getByRole("listitem").filter({ has: p.getByRole("heading", { level: 2 }) });
  await expect(chapters).toHaveCount(9);
  expect(await serious(p)).toEqual([]);

  await p.getByRole("link", { name: "7. Persona (AI influencer)" }).click();
  await expect(p.getByRole("heading", { name: "7. Persona (AI influencer)", level: 1 })).toBeVisible();
  await expect(p.getByTestId("help-chapter").getByRole("heading", { name: "Video s persono", level: 2 })).toBeVisible();
  await p.getByRole("navigation", { name: "Na tej strani" }).getByRole("link", { name: "Potne slike" }).click();
  await expect(p).toHaveURL(/#potne-slike$/);
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("help-chapter.png"), fullPage: true });
  await p.getByRole("link", { name: /Naslednje: Povezava s Claude/ }).click();
  await expect(p.getByRole("heading", { name: "8. Povezava s Claude", level: 1 })).toBeVisible();

  // A link inside a chapter leads to another chapter.
  await p.goto("/app/help/zacetek");
  await p.getByTestId("help-chapter").getByRole("link", { name: "Brand" }).first().click();
  await expect(p.getByRole("heading", { name: "2. Brand", level: 1 })).toBeVisible();
  await ctx.close();
});
