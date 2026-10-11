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

  // TASK-055: a new brand opens in the setup wizard; each step explains why it matters and saves into the brand.
  await expect(p.getByRole("heading", { name: "Nastavitev branda", level: 1 })).toBeVisible();
  await expect(p.getByTestId("setup-step-cgp")).toBeVisible();
  await expect(p.getByTestId("setup-progress")).toContainText("Manjka obvezno: Komunikacija (CGP), Logotip in pretekle objave, Kanali, Vizualna podoba");
  expect(await serious(p)).toEqual([]);
  const cgp = p.getByLabel("Besedilo CGP");
  await cgp.fill("# Inženirji\nPišemo jasno.");
  await expect(p.getByTestId("setup-cgp")).toContainText("priporočamo vsaj 400");
  await cgp.fill(`# Inženirji\n${"Inženirji pišemo jasno, strokovno in brez žargona za lastnike malih podjetij, ki gradijo hiše. ".repeat(6)}`);
  await expect(p.getByTestId("setup-cgp")).toContainText("dovolj za dobre objave");
  await p.getByRole("button", { name: "Shrani in naprej" }).click();
  await expect(p.getByTestId("setup-step-images")).toBeVisible();
  await expect(p.getByTestId("setup-images-status")).toContainText("Logotip manjka");
  await expect(p.getByTestId("setup-steps").getByRole("link", { name: /Komunikacija \(CGP\)/ })).toContainText("(urejeno)");
  await p.getByTestId("setup-steps").getByRole("link", { name: /Teme in pravila/ }).click();
  await p.getByLabel("Steber 1: ime").fill("Nasveti");
  await p.getByLabel("Steber 1: delež v %").fill("60");
  await p.getByLabel("Steber 2: ime").fill("Zgodbe");
  await p.getByLabel("Steber 2: delež v %").fill("40");
  await p.getByLabel("Pozivi k dejanju").fill("Pišite nam");
  await p.getByRole("button", { name: "Shrani in naprej" }).click();
  await expect(p.getByTestId("setup-step-visual")).toBeVisible();
  await p.getByLabel("Glavna", { exact: true }).fill("#0e1630");
  await p.getByLabel("Poudarek").fill("#ffb21a");
  await p.getByLabel("Slog ilustracij").fill("Čiste tehnične risbe hiš na temno modrem ozadju.");
  await p.getByRole("button", { name: "Shrani in naprej" }).click();
  await expect(p.getByTestId("setup-step-channels")).toBeVisible();
  await p.getByLabel("Platforma").selectOption("linkedin");
  await p.getByLabel("Profil (@ime)").fill("@inzenirji");
  await p.getByRole("button", { name: "Dodaj kanal" }).click();
  await expect(p.getByTestId("setup-channels")).toContainText("linkedin · @inzenirji");
  await p.getByRole("link", { name: "Naprej" }).click();
  await expect(p.getByTestId("setup-step-design")).toBeVisible();
  await p.getByRole("button", { name: "Ustvari vizualno podobo" }).click();
  await expect(p.getByTestId("setup-design-ready")).toBeVisible({ timeout: 60_000 });
  await p.getByRole("link", { name: "Naprej" }).click();
  await expect(p.getByTestId("setup-summary")).toContainText("Logotip in pretekle objave");
  await expect(p.getByTestId("setup-step-done")).toContainText("Nekaj obveznega še manjka");
  await expect(p.getByTestId("setup-progress")).toContainText("Manjka obvezno: Logotip in pretekle objave");
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("setup.png"), fullPage: true });
  await p.getByRole("link", { name: "Preskoči na brand" }).click();

  await expect(p.getByRole("heading", { name: "Inženirji", level: 1 })).toBeVisible();
  await expect(p.getByTestId("setup-notice")).toContainText("Manjka obvezno: Logotip in pretekle objave");
  await expect(p.getByText("verzija 4")).toBeVisible(); // CGP, topics and rules, colours: one version each
  await tab(p, "Profil (CGP)");
  await p.getByLabel("CGP — navodila za AI").fill("# Inženirji\nPišemo jasno, strokovno, brez žargona. Čšž.");
  await p.getByLabel("Stebri vsebine").fill("Nasveti | 60 | praktični nasveti\nZgodbe | 40");
  await p.getByLabel("Največ hashtagov", { exact: true }).fill("4");
  await p.getByRole("button", { name: "Shrani novo verzijo" }).click();
  await expect(p.getByRole("status").filter({ hasText: "Shranjeno kot verzija 5." })).toBeVisible();

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
  await expect(p.getByTestId("versions")).toContainText("v5");
  await expect(p.getByTestId("versions")).toContainText("ustvarjen");
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("brand.png"), fullPage: true });
  await ctx.close();
});
