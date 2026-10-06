import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The app frame (TASK-011): sidebar, top bar, theme and language, dashboard, posts table with filters, brands table.
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

test("dashboard, posts and brands in the new frame; filters; theme and language switch; mobile menu", async ({ page, browser }, info) => {
  test.setTimeout(90_000);
  const stamp = Date.now();
  const owner = `shell-${stamp}@example.test`;
  await signIn(page, "e2e-root@example.test");
  await page.goto("/admin/orgs/new");
  await page.getByLabel("Ime", { exact: true }).fill("Okvir E2E");
  await page.getByLabel("Kratko ime (slug)").fill(`okvir-${stamp}`);
  await page.getByLabel("E-pošta lastnika").fill(owner);
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: "Okvir E2E" })).toBeVisible();

  const ctx = await browser.newContext({ ...(info.project.name === "desktop" ? { viewport: { width: 1440, height: 900 } } : {}) });
  const p = await ctx.newPage();
  await signIn(p, owner);
  const mobile = info.project.name === "mobile";
  const go = async (name: string) => {
    if (mobile) await p.getByRole("button", { name: "Odpri meni" }).click();
    await p.getByRole("navigation", { name: "Glavna navigacija" }).getByRole("link", { name, exact: true }).click();
  };

  // Empty organization: dashboard explains the first step.
  await expect(p.getByRole("heading", { name: "Nadzorna plošča", level: 1 })).toBeVisible();
  await expect(p.getByText("Še ni brandov")).toBeVisible();
  expect(await serious(p)).toEqual([]);

  // Two brands, one channel, two posts (stand-in model).
  for (const [name, slug] of [["Inženirji", "inzenirji"], ["AI Builders", "aibuilders"]]) {
    await p.goto("/app/brands/new");
    await p.getByLabel("Ime", { exact: true }).fill(name);
    await p.getByLabel("Kratko ime (slug)").fill(slug);
    await p.getByRole("button", { name: "Ustvari" }).click();
    await expect(p.getByRole("heading", { name, level: 1 })).toBeVisible();
  }
  const tab = (name: string) => p.getByRole("navigation", { name: "Razdelki branda" }).getByRole("link", { name }).click();
  await tab("Kanali");
  await expect(p.getByRole("navigation", { name: "Razdelki branda" }).getByRole("link", { name: /Kanali/ })).toHaveAttribute("aria-current", "page");
  await p.getByLabel("Platforma").selectOption("instagram");
  await p.getByLabel("Profil (@ime)").fill("@aibuilders");
  await p.getByRole("button", { name: "Dodaj kanal" }).click();
  await expect(p.getByTestId("channels")).toContainText("@aibuilders");
  for (const brief of ["Vibe coding is easy", "One loop for every feature"]) {
    await tab("Objave");
    await p.getByLabel("Kaj objavimo?").fill(brief);
    await p.getByRole("button", { name: "Ustvari objavo" }).click();
    await expect(p).toHaveURL(/\/app\/posts\//);
    await p.getByRole("link", { name: "← AI Builders" }).click();
  }

  // Dashboard numbers and recent posts.
  await go("Nadzorna plošča");
  await expect(p.getByTestId("stats")).toContainText("Pripravljene2");
  await expect(p.getByTestId("recent-posts")).toContainText("One loop for every feature");
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("dashboard-dark.png"), fullPage: true });

  // Posts table: search and status filter are in the URL.
  await go("Objave");
  await expect(p.getByTestId("posts-table").getByRole("row")).toHaveCount(3); // head + 2
  await p.getByLabel("Iskanje").fill("loop");
  await p.getByRole("button", { name: "Filtriraj" }).click();
  await expect(p).toHaveURL(/q=loop/);
  await expect(p.getByTestId("posts-table").getByRole("row")).toHaveCount(2);
  await p.getByLabel("Stanje").selectOption("published");
  await p.getByRole("button", { name: "Filtriraj" }).click();
  await expect(p.getByText("Nobena objava se ne ujema s filtri.")).toBeVisible();
  expect(await serious(p)).toEqual([]);

  // Brands table with counts.
  await go("Brandi");
  const row = p.getByTestId("brand-list").getByRole("row").filter({ hasText: "AI Builders" });
  await expect(row).toContainText("/aibuilders");
  await expect(row.getByRole("cell").nth(3)).toHaveText("2");

  // Light theme (cookie, no reload needed) passes the same checks; language switch to English.
  await p.getByRole("button", { name: "Svetla tema" }).click();
  await expect(p.locator("html")).toHaveAttribute("data-theme", "light");
  await p.reload();
  await expect(p.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await serious(p)).toEqual([]);
  await go("Nadzorna plošča");
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("dashboard-light.png"), fullPage: true });
  await p.getByRole("button", { name: /Jezik/ }).click();
  await expect(p.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await ctx.close();
});
