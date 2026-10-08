import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// AI post ideas (TASK-019): ask for ideas on the brand page, review them (tick, change a day), add them to the plan.
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

test("ideas: Claude proposes topics for a channel, the owner keeps some and they land in the plan", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one full flow is enough");
  test.setTimeout(90_000);
  const stamp = Date.now();
  const owner = `ideje-${stamp}@example.test`;
  await signIn(page, "e2e-root@example.test");
  await page.goto("/admin/orgs/new");
  await page.getByLabel("Ime", { exact: true }).fill("Ideje E2E");
  await page.getByLabel("Kratko ime (slug)").fill(`ideje-${stamp}`);
  await page.getByLabel("E-pošta lastnika").fill(owner);
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: "Ideje E2E" })).toBeVisible();

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await signIn(p, owner);
  await p.goto("/app/brands/new");
  await p.getByLabel("Ime", { exact: true }).fill("Kavarna");
  await p.getByRole("button", { name: "Ustvari" }).click();
  await expect(p.getByRole("heading", { name: "Kavarna", level: 1 })).toBeVisible();
  const tab = (name: string) => p.getByRole("navigation", { name: "Razdelki branda" }).getByRole("link", { name }).click();
  await tab("Kanali");
  await p.getByLabel("Platforma").selectOption("instagram");
  await p.getByLabel("Profil (@ime)").fill("@kavarna");
  await p.getByRole("button", { name: "Dodaj kanal" }).click();
  await expect(p.getByTestId("channels")).toContainText("@kavarna");

  await tab("Objave");
  const form = p.getByTestId("ideas-form");
  await form.getByLabel("Koliko idej").fill("3");
  await form.getByLabel("Želja (neobvezno)").fill("Jesen");
  expect(await serious(p)).toEqual([]);
  await form.getByRole("button", { name: "Predlagaj ideje" }).click();
  await expect(p).toHaveURL(/\/app\/ideas\/[^/]+$/);
  await expect(p.getByRole("heading", { name: "Predlogi idej", level: 1 })).toBeVisible();
  const list = p.getByTestId("ideas-list").getByRole("listitem");
  await expect(list).toHaveCount(3);
  await expect(list.first()).toContainText("Jesen 1: kava z ovsenim mlekom");
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("ideas.png"), fullPage: true });
  // Keep the first two; move the second to another day.
  await p.getByLabel("Jesen 3: domači piškoti iz pekarne").uncheck();
  await list.nth(1).getByLabel("Dan").fill("2030-01-15");
  await p.getByRole("button", { name: "Dodaj označene v plan" }).click();
  await expect(p).toHaveURL(/\/app\/plan\?brand=/);
  await p.goto("/app/plan?tab=unscheduled");
  await p.goto("/app/plan?view=day&d=2030-01-15");
  await expect(p.getByTestId("plan-day")).toContainText("Jesen 2: čajni rituali za deževne dni");
  await expect(p.getByTestId("plan-day").getByRole("row")).toHaveCount(2);
  await ctx.close();
});
