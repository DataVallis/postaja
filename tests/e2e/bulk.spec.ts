import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { todayIn } from "../../src/lib/dates";
import { makeXlsx } from "../fixtures/files";

// Bulk creation (TASK-014): a day across two brands from the plan's day view, a brand's planned posts from its page,
// one planned post from its own page. Runs in the background (pg-boss worker in the E2E server, AI stand-in).
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

test("bulk: a day across brands, a brand's plan, a single planned post", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one full flow is enough");
  test.setTimeout(120_000);
  const stamp = Date.now();
  const owner = `bulk-${stamp}@example.test`;
  const today = todayIn();
  await signIn(page, "e2e-root@example.test");
  await page.goto("/admin/orgs/new");
  await page.getByLabel("Ime", { exact: true }).fill("Bulk E2E");
  await page.getByLabel("Kratko ime (slug)").fill(`bulk-${stamp}`);
  await page.getByLabel("E-pošta lastnika").fill(owner);
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: "Bulk E2E" })).toBeVisible();

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await signIn(p, owner);
  const tab = (name: string) => p.getByRole("navigation", { name: "Razdelki branda" }).getByRole("link", { name }).click();
  for (const [name, slug, platform, handle] of [["Inženirji", "inzenirji", "instagram", "@inzenirji"], ["AI Builders", "aibuilders", "linkedin", "aibuilders"]]) {
    await p.goto("/app/brands/new");
    await p.getByLabel("Ime", { exact: true }).fill(name);
    await p.getByLabel("Kratko ime (slug)").fill(slug);
    await p.getByRole("button", { name: "Ustvari" }).click();
    await expect(p.getByRole("heading", { name, level: 1 })).toBeVisible();
    await tab("Kanali");
    await p.getByLabel("Platforma").selectOption(platform);
    await p.getByLabel("Profil (@ime)").fill(handle);
    await p.getByRole("button", { name: "Dodaj kanal" }).click();
    await expect(p.getByTestId("channels")).toContainText(handle);
  }

  // A plan without texts: two posts today (two brands), one later this week (Inženirji), one more for a single run.
  const plan = makeXlsx([{ name: "Plan", rows: [
    ["Datum", "Ura", "Platforma", "Račun", "Tema", "Format", "Besedilo"],
    [today, "09:00", "Instagram", "@inzenirji", "Server soba", "Single image", ""],
    [today, "12:00", "LinkedIn", "aibuilders", "Vibe coding", "Text", ""],
    [todayIn(undefined, new Date(Date.now() + 2 * 86_400_000)), "09:00", "Instagram", "@inzenirji", "Pozneje ta teden", "Single image", ""],
    [todayIn(undefined, new Date(Date.now() + 3 * 86_400_000)), "09:00", "LinkedIn", "aibuilders", "Posamezna", "Text", ""],
  ] }]);
  await p.goto("/app/import");
  await p.getByLabel("Izberi plan").setInputFiles({ name: "plan.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(plan) });
  await expect(p).toHaveURL(/\/app\/import\/[^/]+$/);
  await expect(p.getByTestId("import-stats")).toBeVisible({ timeout: 30_000 }); // read in the background (ADR-078)
  await p.getByRole("button", { name: "Uvozi 4 objav" }).click();
  await expect(p).toHaveURL(/\/app\/posts\?import=/);

  // Day view: both of today's posts, both brands, in the background.
  await p.goto("/app/plan?view=day");
  await expect(p.getByTestId("day-bulk")).toContainText("2 objavi ta dan nimata besedila");
  expect(await serious(p)).toEqual([]);
  await p.getByRole("button", { name: "Ustvari besedila (2)" }).click();
  // First the cost (owner, 2026-10-07): what will be made, expected and at most, against the month's cap.
  await expect(p).toHaveURL(/\/app\/bulk\/new\?/);
  const preview = p.getByTestId("bulk-preview");
  await expect(preview.getByTestId("estimate-text-count")).toHaveText("2 objavi");
  await expect(preview.getByTestId("estimate-expected")).toHaveText(/^≈ \d+\.\d\d €$/);
  await expect(preview.getByTestId("estimate-max")).toHaveText(/^\d+\.\d\d €$/);
  await expect(preview.getByTestId("bulk-budget")).toContainText("Ta mesec porabljeno");
  // Switching to texts and images shows that these brands get no images yet (no visual identity).
  await preview.getByRole("navigation", { name: "Kaj naj ustvarim" }).getByRole("link", { name: "Besedila in slike" }).click();
  await expect(p.getByTestId("no-design")).toContainText("2 objavi ne bosta dobili slik");
  await p.getByRole("navigation", { name: "Kaj naj ustvarim" }).getByRole("link", { name: "Besedila", exact: true }).click();
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("bulk-preview.png"), fullPage: true });
  await p.getByRole("button", { name: /^Začni \(2\)/ }).click();
  await expect(p).toHaveURL(/tab=runs/);
  const run = p.getByTestId("bulk-runs").getByRole("row").nth(1);
  await expect(run).toContainText("vsi brandi");
  await expect(run).toContainText("končano", { timeout: 30_000 }); // the page refreshes itself
  await expect(run.getByTestId("run-counts")).toHaveText("2 / 2 napisanih");
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("bulk-runs.png"), fullPage: true });
  await p.goto("/app/plan?view=day");
  // Texts are done; images need a brand design (TASK-017), which these brands do not have, so nothing is left.
  await expect(p.getByTestId("day-bulk")).toHaveCount(0);
  await expect(p.getByTestId("plan-day")).toContainText("Topic: Server soba. Link v bio");
  await expect(p.getByTestId("plan-day")).toContainText("Topic: Vibe coding. Link v bio");

  // Brand page: the rest of Inženirji's plan for the next 7 days.
  await p.goto("/app/brands");
  await p.getByRole("link", { name: "Inženirji" }).click();
  await expect(p.getByTestId("brand-bulk")).toContainText("1 planirana objava brez besedila");
  await p.getByRole("button", { name: "Ustvari besedila" }).click();
  await expect(p.getByTestId("estimate-text-count")).toHaveText("1 objava");
  await p.getByRole("button", { name: /^Začni \(1\)/ }).click();
  await expect(p.getByTestId("bulk-runs").getByRole("row").nth(1)).toContainText("končano", { timeout: 30_000 });

  // A single planned post from its own page.
  await p.goto("/app/plan?tab=unscheduled");
  await p.goto(`/app/plan?view=day&d=${todayIn(undefined, new Date(Date.now() + 3 * 86_400_000))}`);
  await p.getByRole("link", { name: "Posamezna" }).click();
  await p.getByRole("button", { name: "Napiši besedilo z AI" }).click();
  await expect(p.getByTestId("status")).toHaveText("pripravljena");
  await expect(p.getByLabel("Besedilo")).toHaveValue(/^Topic: Posamezna\. Link v bio/);
  await ctx.close();
});
