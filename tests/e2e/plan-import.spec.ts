import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { makeDocx, makeXlsx } from "../fixtures/files";

// Plan import (TASK-012): an Excel plan over three accounts and a Word plan, read by the AI stand-in, reviewed and
// imported verbatim; published rows become history, text-less rows stay planned.
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

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

test("owner imports an Excel plan over three accounts and a Word plan; history, planned and ready posts", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one full flow is enough");
  test.setTimeout(90_000);
  const stamp = Date.now();
  const owner = `plan-${stamp}@example.test`;
  await signIn(page, "e2e-root@example.test");
  await page.goto("/admin/orgs/new");
  await page.getByLabel("Ime", { exact: true }).fill("Plani E2E");
  await page.getByLabel("Kratko ime (slug)").fill(`plani-${stamp}`);
  await page.getByLabel("E-pošta lastnika").fill(owner);
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: "Plani E2E" })).toBeVisible();

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await signIn(p, owner);
  const tab = (name: string) => p.getByRole("navigation", { name: "Razdelki branda" }).getByRole("link", { name }).click();
  const brand = async (name: string, slug: string, channels: [string, string][]) => {
    await p.goto("/app/brands/new");
    await p.getByLabel("Ime", { exact: true }).fill(name);
    await p.getByLabel("Kratko ime (slug)").fill(slug);
    await p.getByRole("button", { name: "Ustvari" }).click();
    await expect(p.getByRole("heading", { name, level: 1 })).toBeVisible();
    await tab("Kanali");
    for (const [platform, handle] of channels) {
      await p.getByLabel("Platforma").selectOption(platform);
      await p.getByLabel("Profil (@ime)").fill(handle);
      await p.getByRole("button", { name: "Dodaj kanal" }).click();
      await expect(p.getByTestId("channels")).toContainText(handle);
    }
  };
  await brand("David Tacer", "davidtacer", [["linkedin", "david-tacer"], ["x", "@davitacer"]]);
  await brand("AI Builders", "aibuilders", [["instagram", "@aibuilders"]]);

  // An Excel plan like the owner's "30 dni objav": dates as Excel numbers, three accounts, a carousel, a published row.
  const plan = makeXlsx([{ name: "Plan objav", rows: [
    ["Datum", "Dan", "Ura", "Platforma", "Račun", "Format", "Tema", "Besedilo objave", "Prompt za sliko (AI)", "Carousel slide-i", "Status"],
    [46294, "tor", "08:30", "LinkedIn", "David (osebni profil)", "Text + image", "Problem", "AI can write an app in an afternoon.\n\nMost AI-built apps still break.", "A figure at a wall of navy blocks", "—", "Za objavo"],
    [46294, "tor", "18:00", "Instagram", "@aibuilders", "Carousel (3)", "Problem", "Vibe coding is easy. Until it isn't. 👇", "Isometric laptop", "1: Easy.\n2: Deploy fails.\n3: Learn the method.", "Objavljeno"],
    [46295, "sre", "13:00", "X", "@davitacer", "Single", "Tip", "Don't change anything yet. First explain.", "—", "—", "Za objavo"],
    [46296, "čet", "18:00", "Instagram", "@aibuilders", "Single image", "Reel idea", "", "Dark desk, neon clock", "—", "Za objavo"],
  ] }]);
  await p.getByRole("navigation", { name: "Glavna navigacija" }).getByRole("link", { name: "Uvoz planov" }).click();
  await expect(p.getByRole("heading", { name: "Uvoz planov", level: 1 })).toBeVisible();
  expect(await serious(p)).toEqual([]);
  await p.getByLabel("Izberi plan").setInputFiles({ name: "AI-Builders-30-dni-objav.xlsx", mimeType: XLSX, buffer: Buffer.from(plan) });
  await expect(p).toHaveURL(/\/app\/import\/[^/]+$/);
  await expect(p.getByRole("heading", { name: "AI-Builders-30-dni-objav.xlsx", level: 1 })).toBeVisible();
  await expect(p.getByText("Strukturo je prebral AI")).toBeVisible();
  await expect(p.getByTestId("import-stats")).toContainText("Objav v planu4");
  await expect(p.getByTestId("import-stats")).toContainText("Že objavljenih1");
  await expect(p.getByTestId("import-stats")).toContainText("Brez besedila1");

  // @aibuilders and @davitacer are matched to their channels; the LinkedIn account name is not a handle → pick it.
  const groups = p.getByTestId("import-groups");
  await expect(groups.getByLabel("Kanal za Instagram · @aibuilders")).toHaveValue(/.+/);
  await expect(groups.getByLabel("Kanal za X · @davitacer")).toHaveValue(/.+/);
  await groups.getByLabel("Kanal za LinkedIn · David (osebni profil)").selectOption({ label: "David Tacer · LinkedIn · david-tacer" });
  await expect(p.getByTestId("import-items")).toContainText("Vibe coding is easy. Until it isn't. 👇");
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("import-review.png"), fullPage: true });
  await p.getByRole("button", { name: "Uvozi 4 objav" }).click();

  // Posts of the import, in plan order: LinkedIn (ready), Instagram (history), X (ready), Instagram (planned, no text).
  await expect(p).toHaveURL(/\/app\/posts\?import=/);
  const rows = p.getByTestId("posts-table").getByRole("row");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(1)).toContainText("08:30");
  await expect(rows.nth(1)).toContainText("pripravljena");
  await expect(rows.nth(2)).toContainText("objavljena");
  await expect(rows.nth(2)).toContainText("karusel");
  await expect(rows.nth(4)).toContainText("v planu");
  await p.screenshot({ path: info.outputPath("import-posts.png"), fullPage: true });

  // The carousel keeps its slides and image prompt; the text is verbatim.
  await rows.nth(2).getByRole("link").first().click();
  await expect(p.getByLabel("Besedilo")).toHaveValue("Vibe coding is easy. Until it isn't. 👇");
  await expect(p.getByTestId("plan")).toContainText("Isometric laptop");
  await expect(p.getByTestId("plan").getByRole("listitem")).toHaveText(["Easy.", "Deploy fails.", "Learn the method."]);
  expect(await serious(p)).toEqual([]);

  // The text-less plan item: the owner writes the text by hand → ready.
  await p.goBack();
  await p.getByTestId("posts-table").getByRole("row").nth(4).getByRole("link").first().click();
  await expect(p.getByTestId("planned-hint")).toBeVisible();
  await p.getByLabel("Besedilo").fill("Ob 7:00 je miza še prazna. Link v bio");
  await p.getByRole("button", { name: "Shrani spremembe" }).click();
  await expect(p.getByTestId("status")).toHaveText("pripravljena");

  // Importing the same file again creates no duplicates.
  await p.goto("/app/import");
  await p.getByLabel("Izberi plan").setInputFiles({ name: "AI-Builders-30-dni-objav.xlsx", mimeType: XLSX, buffer: Buffer.from(plan) });
  await expect(p).toHaveURL(/\/app\/import\/[^/]+$/);
  await p.getByTestId("import-groups").getByLabel("Kanal za LinkedIn · David (osebni profil)").selectOption({ label: "David Tacer · LinkedIn · david-tacer" });
  await p.getByRole("button", { name: /^Uvozi \d+ objav$/ }).click();
  await expect(p).toHaveURL(/\/app\/posts\?import=/);
  await expect(p.getByText("Nobena objava se ne ujema s filtri.")).toBeVisible();

  // A Word plan (LinkedIn series): posts found by the AI stand-in, undated → start day + every 3 days.
  const doc = makeDocx([
    { text: "LinkedIn series", style: "Heading1" },
    { text: "Objava 1: 25 bugs", style: "Heading2" },
    { text: "The code compiled. The tests were green." },
    { text: "Slika: a stack of glowing blocks" },
    { text: "Objava 2: whoever writes doesn't approve", style: "Heading2" },
    { text: "The AI that writes your code is the worst judge of it." },
  ]);
  await p.goto("/app/import");
  await p.getByLabel("Izberi plan").setInputFiles({ name: "davidtacer-Linkedin-objave.docx", mimeType: DOCX, buffer: Buffer.from(doc) });
  await expect(p).toHaveURL(/\/app\/import\/[^/]+$/);
  await expect(p.getByTestId("import-stats")).toContainText("Objav v planu2");
  await expect(p.getByTestId("import-groups").getByLabel("Kanal za LinkedIn")).toHaveValue(/.+/);
  await p.getByLabel("Začetni dan").fill("2026-11-02");
  await p.getByLabel("Razmik (dni)").fill("3");
  await p.getByRole("button", { name: "Shrani izbire" }).click();
  await expect(p.getByTestId("import-items")).toContainText("2. 11. 2026");
  await expect(p.getByTestId("import-items")).toContainText("5. 11. 2026");
  await p.getByRole("button", { name: "Uvozi 2 objav" }).click();
  await expect(p.getByTestId("posts-table").getByRole("row")).toHaveCount(3);
  await p.getByTestId("posts-table").getByRole("row").nth(1).getByRole("link").first().click();
  await expect(p.getByLabel("Besedilo")).toHaveValue("The code compiled. The tests were green.");
  await expect(p.getByTestId("plan")).toContainText("Minimal 3D, navy background");

  // A plan for a brand that is not in Postaja yet (owner, 2026-10-07): no other brand's X channel is offered; the owner
  // creates the brand and its X channel from the review, and the posts land there.
  const cherr = makeXlsx([{ name: "X", rows: [["Datum", "Platforma", "Besedilo objave"], [46300, "X", "Ship small. Ship often."], [46301, "X", "Your backlog is a graveyard."]] }]);
  await p.goto("/app/import");
  await p.getByLabel("Izberi plan").setInputFiles({ name: "CHERR.IO X posts 001 (1).xlsx", mimeType: XLSX, buffer: Buffer.from(cherr) });
  await expect(p).toHaveURL(/\/app\/import\/[^/]+$/);
  await expect(p.getByTestId("import-brand")).toContainText("Brand še ni izbran");
  await expect(p.getByTestId("import-groups").getByLabel("Kanal za X")).toHaveValue("");
  const brandForm = p.getByTestId("import-brand-form");
  await expect(brandForm.getByLabel("Brand", { exact: true })).toHaveValue("new");
  await expect(brandForm.getByLabel("Ime novega branda")).toHaveValue("CHERR.IO");
  await brandForm.getByLabel("Jezik novega branda").selectOption("en");
  await brandForm.getByLabel("Profil za X").fill("@cherr_io");
  expect(await serious(p)).toEqual([]);
  await brandForm.getByRole("button", { name: "Uporabi brand" }).click();
  await expect(p.getByTestId("import-brand")).toContainText("Plan je za brand CHERR.IO");
  await expect(p.getByTestId("import-groups").getByLabel("Kanal za X").locator("option:checked")).toHaveText("CHERR.IO · X · @cherr_io");
  await p.getByRole("button", { name: "Uvozi 2 objav" }).click();
  await expect(p.getByTestId("posts-table").getByRole("row")).toHaveCount(3);
  await expect(p.getByTestId("posts-table")).toContainText("CHERR.IO");
  await ctx.close();
});
