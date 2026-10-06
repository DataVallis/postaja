import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { expect, test, type Page } from "@playwright/test";
import { todayIn } from "../../src/lib/dates";
import { makeXlsx } from "../fixtures/files";

// Post images (TASK-015): the brand's template with a live preview, images for a planned post from its plan (AI
// background from the fal stand-in + text by Postaja), download, text refresh, a carousel, and bulk images for a day.
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

test("images: brand template with preview, a post's images, text refresh, carousel, bulk images", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one full flow is enough");
  test.setTimeout(120_000);
  const stamp = Date.now();
  const owner = `slike-${stamp}@example.test`;
  const today = todayIn();
  await signIn(page, "e2e-root@example.test");
  await page.goto("/admin/orgs/new");
  await page.getByLabel("Ime", { exact: true }).fill("Slike E2E");
  await page.getByLabel("Kratko ime (slug)").fill(`slike-${stamp}`);
  await page.getByLabel("E-pošta lastnika").fill(owner);
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: "Slike E2E" })).toBeVisible();

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await signIn(p, owner);
  await p.goto("/app/brands/new");
  await p.getByLabel("Ime", { exact: true }).fill("Cherr");
  await p.getByLabel("Kratko ime (slug)").fill("cherr");
  await p.getByRole("button", { name: "Ustvari" }).click();
  const tab = (name: string) => p.getByRole("navigation", { name: "Razdelki branda" }).getByRole("link", { name }).click();
  await tab("Kanali");
  await p.getByLabel("Platforma").selectOption("instagram");
  await p.getByLabel("Profil (@ime)").fill("@cherr");
  await p.getByRole("button", { name: "Dodaj kanal" }).click();
  await expect(p.getByTestId("channels")).toContainText("@cherr");
  // A logo, used by the template's footer.
  await tab("Datoteke");
  const logo = await sharp({ create: { width: 800, height: 200, channels: 4, background: "#ffffff" } }).png().toBuffer();
  await p.getByLabel("Dodaj logotip").setInputFiles({ name: "cherr-logo.png", mimeType: "image/png", buffer: logo });
  await expect(p.getByTestId("logo-frame")).toHaveCount(1);

  // Template: card layout, red accent, footer text; the preview follows the form.
  await tab("Slike");
  const preview = p.getByTestId("template-preview");
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(540);
  const first = await preview.getAttribute("src");
  await p.getByLabel("Tekst v nogi").fill("Polygon");
  await p.getByLabel("Poudarek").fill("#e0112b");
  await expect.poll(() => preview.getAttribute("src")).not.toBe(first);
  await expect(preview).toHaveAttribute("src", /footerText=Polygon/);
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(540);
  expect(await serious(p)).toEqual([]);
  await p.getByRole("button", { name: "Shrani predlogo" }).click();
  await expect(p.getByRole("status")).toContainText("verzija 2");
  await p.screenshot({ path: info.outputPath("template.png"), fullPage: true });

  // A plan with an image post and a carousel for today.
  const plan = makeXlsx([{ name: "IG", rows: [
    ["Datum", "Platforma", "Račun", "Format", "Kategorija", "Tema", "Tekst na sliki", "Slika", "Slajdi"],
    [today, "Instagram", "@cherr", "Text + image", "The problem", "Zaklep", "Daš. Zaklenjeno je.\nIzplača se v korakih.", "Dark glass vault, red light", ""],
    [today, "Instagram", "@cherr", "Carousel (3)", "Kako", "Koraki", "", "Isometric steps", "1: Prvi korak\n2: Drugi korak\n3: Tretji korak"],
  ] }]);
  await p.goto("/app/import");
  await p.getByLabel("Izberi plan").setInputFiles({ name: "plan.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(plan) });
  await expect(p).toHaveURL(/\/app\/import\/[^/]+$/);
  await p.getByRole("button", { name: "Uvozi 2 objav" }).click();
  await expect(p).toHaveURL(/\/app\/posts\?import=/);

  // The image post: make its images.
  await p.getByRole("link", { name: /Zaklep|Daš/ }).first().click();
  const images = p.getByTestId("images");
  await expect(images.getByTestId("images-status")).toHaveText("Ni slik");
  await images.getByRole("button", { name: "Ustvari slike" }).click();
  await expect(images.getByTestId("images-status")).toHaveText("Pripravljene", { timeout: 30_000 });
  const img = images.getByTestId("image-list").getByRole("img");
  await expect(img).toHaveCount(1);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(1080);
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("post-images.png"), fullPage: true });
  // Download: a PNG file named after the brand and day.
  const [download] = await Promise.all([p.waitForEvent("download"), images.getByTestId("image-download").first().click()]);
  expect(download.suggestedFilename()).toBe(`cherr-${today}-1.png`);
  const file = fs.readFileSync((await download.path())!);
  expect(await sharp(file).metadata()).toMatchObject({ format: "png", width: 1080, height: 1350 });
  // Background from the stand-in (teal → amber), darkened, in the top-left corner.
  const [r, g, b] = (await sharp(file).extract({ left: 10, top: 10, width: 1, height: 1 }).raw().toBuffer()).subarray(0, 3);
  expect(g).toBeGreaterThan(r);
  expect(g).toBeGreaterThan(b - 30);

  // New text, refreshed on the same background.
  const oldSrc = await img.getAttribute("src");
  await images.getByLabel("Tekst na sliki").fill("Nov naslov.\nŠe ena vrstica.");
  await images.getByRole("button", { name: "Shrani tekst" }).click();
  await expect(images.getByLabel("Tekst na sliki")).toHaveValue("Nov naslov.\nŠe ena vrstica.");
  await images.getByRole("button", { name: "Osveži tekst" }).click();
  await expect(images.getByTestId("images-status")).toHaveText("Pripravljene", { timeout: 30_000 });
  await expect.poll(() => images.getByTestId("image-list").getByRole("img").getAttribute("src")).not.toBe(oldSrc);

  // Bulk: the day's remaining post (the carousel) gets its images from the plan view.
  await p.goto(`/app/plan?view=day&d=${today}`);
  await p.getByTestId("day-bulk").getByRole("button", { name: "Ustvari slike (1)" }).click();
  await expect(p).toHaveURL(/tab=runs/);
  await expect(p.getByTestId("bulk-runs").getByTestId("run-counts").first()).toHaveText("1 / 1 končanih", { timeout: 30_000 });
  await p.goto(`/app/plan?view=day&d=${today}`);
  await p.getByTestId("plan-day").getByRole("link", { name: /Koraki|Prvi korak/ }).first().click();
  await expect(p.getByTestId("images").getByTestId("image-list").getByRole("img")).toHaveCount(3);
  await ctx.close();
});
