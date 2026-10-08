import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

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

// Competitor research, step 1 (TASK-049): Claude (web search) suggests competitors; the owner keeps, removes and adds.
test("competitors: Claude suggests, the owner keeps, removes and adds their own", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one flow is enough");
  test.setTimeout(180_000);
  const stamp = Date.now();
  const owner = `konk-${stamp}@example.test`;
  await signIn(page, "e2e-root@example.test");
  await page.goto("/admin/orgs/new");
  await page.getByLabel("Ime", { exact: true }).fill("Konkurenca E2E");
  await page.getByLabel("Kratko ime (slug)").fill(`konk-${stamp}`);
  await page.getByLabel("E-pošta lastnika").fill(owner);
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: "Konkurenca E2E" })).toBeVisible();

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await signIn(p, owner);
  await p.goto("/app/brands/new");
  await p.getByLabel("Ime", { exact: true }).fill("Tečaj");
  await p.getByLabel("Kratko ime (slug)").fill("tecaj");
  await p.getByRole("button", { name: "Ustvari" }).click();
  await p.getByRole("navigation", { name: "Razdelki branda" }).getByRole("link", { name: "Kanali" }).click();
  await p.getByLabel("Platforma").selectOption("linkedin");
  await p.getByLabel("Profil (@ime)").fill("tecaj");
  await p.getByRole("button", { name: "Dodaj kanal" }).click();
  await expect(p.getByTestId("channels")).toContainText("tecaj");
  await p.getByRole("navigation", { name: "Razdelki branda" }).getByRole("link", { name: "Konkurenca" }).click();
  const section = p.getByTestId("competitors");
  await expect(section.getByTestId("competitors-kept")).toContainText("Še ni konkurentov.");
  await expect(section.getByTestId("find-competitors")).toContainText("Največ");
  expect(await serious(p)).toEqual([]);

  await section.getByLabel("Želja za iskanje (neobvezno)").fill("samo slovenski");
  await section.getByRole("button", { name: "Najdi konkurente" }).click();
  const suggested = p.getByTestId("competitors-suggested");
  await expect(suggested.getByTestId("competitor")).toHaveCount(3, { timeout: 30_000 });
  await expect(suggested).toContainText("Isti tečaj za ne-programerje. samo slovenski");
  await expect(suggested.getByRole("link", { name: "koda-akademija.example" })).toHaveAttribute("target", "_blank");
  await expect(p.getByTestId("competitor-run")).toContainText("3 novi predlogi");
  await p.screenshot({ path: info.outputPath("competitors.png"), fullPage: true });

  await suggested.getByRole("button", { name: "Obdrži Koda Akademija" }).click();
  await expect(p.getByTestId("competitors-kept")).toContainText("Koda Akademija");
  await p.getByTestId("competitors-suggested").getByRole("button", { name: "Odstrani Globalna Platforma" }).click();
  await expect(p.getByTestId("competitors-suggested").getByTestId("competitor")).toHaveCount(1);

  const add = p.getByTestId("add-competitor");
  await add.getByLabel("Ime").fill("Moj Tekmec");
  await add.getByLabel("Spletna stran").fill("tekmec.example");
  await add.getByLabel("Profil na omrežju").selectOption("linkedin");
  await add.getByLabel("Povezava do profila").fill("linkedin.com/company/tekmec");
  await add.getByRole("button", { name: "Dodaj" }).click();
  await expect(p.getByTestId("competitors-kept").getByTestId("competitor")).toHaveCount(2);
  await expect(p.getByTestId("competitors-kept")).toContainText("tekmec.example");
  // A duplicate is refused with a message.
  await p.getByTestId("add-competitor").getByLabel("Ime").fill("koda akademija");
  await p.getByTestId("add-competitor").getByRole("button", { name: "Dodaj" }).click();
  await expect(p.getByTestId("competitors").getByRole("alert")).toHaveText("Ta konkurent je že na seznamu.");
  await expect(p.getByRole("navigation", { name: "Razdelki branda" }).getByRole("link", { name: /Konkurenca/ })).toContainText("2");
  expect(await serious(p)).toEqual([]);

  // Step 2 (TASK-050): a screenshot of a competitor's post, then the analysis.
  const koda = p.getByTestId("competitors-kept").getByTestId("competitor").filter({ hasText: "Koda Akademija" });
  const shot = await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#ffcc00" } }).png().toBuffer();
  await koda.getByLabel("Dodaj posnetke zaslona za Koda Akademija").setInputFiles({ name: "objava.png", mimeType: "image/png", buffer: shot });
  await expect(koda.getByTestId("screenshots").getByRole("img")).toHaveCount(1);
  await expect(koda.getByTestId("page-status")).toHaveText("Spletna stran bo prebrana ob analizi.");
  await p.getByTestId("analyze").getByRole("button", { name: "Analiziraj konkurente" }).click();
  const rep = p.getByTestId("competitor-report");
  await expect(rep).toContainText("Analiziranih konkurentov: 2, posnetkov: 1.", { timeout: 30_000 });
  // The made-up domains cannot be read; that is shown, the analysis still ran.
  await expect(p.getByTestId("competitors-kept").getByTestId("competitor").filter({ hasText: "Koda Akademija" }).getByTestId("page-status")).toContainText("Spletne strani ni bilo mogoče prebrati");
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("competitor-report.png"), fullPage: true });

  await rep.getByRole("button", { name: "Da: Številčni karuseli" }).click();
  await expect(p.getByTestId("competitor-report").getByRole("button", { name: "Da: Številčni karuseli" })).toHaveAttribute("aria-pressed", "true");
  await p.getByTestId("competitor-report").getByRole("button", { name: "Pošlji sprejete v CGP (1)" }).click();
  await expect(p).toHaveURL(/tab=profile/);
  await p.getByRole("button", { name: "Vstavi v urejevalnik" }).click();
  await expect(p.getByLabel("CGP — navodila za AI")).toHaveValue(/## Iz analize konkurence[\s\S]*Številčni karuseli: Ustreza našemu stebru\./);

  // A topic gap opens the ideas form with the topic as the wish.
  await p.getByRole("navigation", { name: "Razdelki branda" }).getByRole("link", { name: /Konkurenca/ }).click();
  await p.getByTestId("gaps").getByRole("link", { name: "Predlagaj ideje" }).click();
  await expect(p.getByLabel("Želja (neobvezno)")).toHaveValue("Primerjava cen tečajev");
  await ctx.close();
});
