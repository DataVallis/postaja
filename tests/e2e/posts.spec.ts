import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const MAIL_DIR = path.resolve("test-results/mail");
function latestLinkTo(email: string): string | undefined {
  if (!fs.existsSync(MAIL_DIR)) return undefined;
  for (const f of fs.readdirSync(MAIL_DIR).sort().reverse()) {
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

test("owner asks for a post, gets it checked against the rules, edits, approves and marks it published", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one full flow is enough");
  const stamp = Date.now();
  const owner = `posts-owner-${stamp}@example.test`;
  await signIn(page, "e2e-root@example.test");
  await page.goto("/admin/orgs/new");
  await page.getByLabel("Ime", { exact: true }).fill("Objave E2E");
  await page.getByLabel("Kratko ime (slug)").fill(`objave-${stamp}`);
  await page.getByLabel("E-pošta lastnika").fill(owner);
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: "Objave E2E" })).toBeVisible();

  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await signIn(p, owner);
  await p.goto("/app/brands/new");
  await p.getByLabel("Ime", { exact: true }).fill("Inženirji");
  await p.getByLabel("Kratko ime (slug)").fill("inzenirji");
  await p.getByRole("button", { name: "Ustvari" }).click();
  await expect(p.getByRole("heading", { name: "Inženirji", level: 1 })).toBeVisible();
  await expect(p.getByText("Brand še nima kanala.")).toBeVisible();

  await p.getByLabel("CGP — navodila za AI").fill("# Inženirji\nPišemo strokovno in toplo.");
  await p.getByLabel("Prepovedane besede").fill("poceni");
  await p.getByLabel("CTA fraze").fill("link v bio");
  await p.getByRole("button", { name: "Shrani novo verzijo" }).click();
  await expect(p.getByRole("status").filter({ hasText: "Shranjeno kot verzija 2." })).toBeVisible();
  await p.getByLabel("Platforma").selectOption("instagram");
  await p.getByLabel("Profil (@ime)").fill("@inzenirji");
  await p.getByRole("button", { name: "Dodaj kanal" }).click();
  await expect(p.getByTestId("channels")).toContainText("instagram · @inzenirji");

  // Ask for a post → lands on the post, ready, with the brand's CTA and the hashtag appended.
  await p.getByLabel("Kaj objavimo?").fill("Jesenski tečaj se začne");
  await p.getByRole("button", { name: "Ustvari objavo" }).click();
  await expect(p).toHaveURL(/\/app\/posts\//);
  await expect(p.getByTestId("status")).toHaveText("pripravljena");
  await expect(p.getByLabel("Besedilo")).toHaveValue("Jesenski tečaj se začne. Link v bio\n\n#e2e");
  await expect(p.getByText(/\/ 2200 znakov/)).toBeVisible();
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("post-ready.png"), fullPage: true });

  // A hand edit that breaks a brand rule is saved but flagged.
  await p.getByLabel("Besedilo").fill("Poceni tečaj! Link v bio");
  await p.getByRole("button", { name: "Shrani spremembe" }).click();
  await expect(p.getByRole("status").filter({ hasText: "Shranjeno, a objava še krši pravila" })).toBeVisible();
  await expect(p.getByTestId("status")).toHaveText("za pregled");
  await expect(p.getByTestId("failures")).toContainText("Prepovedana beseda: »poceni«.");
  await p.getByLabel("Besedilo").fill("Dober tečaj. Link v bio");
  await p.getByRole("button", { name: "Shrani spremembe" }).click();
  await expect(p.getByTestId("status")).toHaveText("pripravljena");

  await p.getByRole("button", { name: "Odobri" }).click();
  await expect(p.getByTestId("status")).toHaveText("odobrena");
  await p.getByRole("button", { name: "Označi kot objavljeno" }).click();
  await expect(p.getByTestId("status")).toHaveText("objavljena");

  // A draft that keeps breaking the rules ends in "za pregled" with the reason listed.
  await p.getByRole("link", { name: "← Inženirji" }).click();
  await p.getByLabel("Kaj objavimo?").fill("POCENI akcija");
  await p.getByRole("button", { name: "Ustvari objavo" }).click();
  await expect(p.getByTestId("status")).toHaveText("za pregled");
  await expect(p.getByTestId("failures")).toContainText("Prepovedana beseda: »poceni«.");
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("post-review.png"), fullPage: true });

  await p.getByRole("link", { name: "← Inženirji" }).click();
  await expect(p.getByTestId("posts")).toContainText("objavljena");
  await expect(p.getByTestId("posts")).toContainText("za pregled");
  await ctx.close();
});
