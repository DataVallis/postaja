import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzip } from "../../src/server/files/zip";

// Ads (TASK-021): an ad concept for Meta and Google, copy written per network within its limits, edited, checked, exported.
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

test("ads: Claude writes copy per network within its limits; the owner edits, the copy is checked, copy.csv", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one full flow is enough");
  test.setTimeout(150_000);
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
  const adUrl = p.url();
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

  // Creatives need the brand's visual identity: Claude designs it, then the ad gets an image per placement × variant.
  await expect(p.getByTestId("creatives").getByTestId("no-design")).toBeVisible();
  await p.getByTestId("creatives").getByRole("link", { name: "Ustvari vizualno podobo" }).click();
  const design = p.getByTestId("design");
  await design.getByLabel("Kako naj grafike izgledajo?").fill("Temne kartice, rdeč poudarek.");
  await design.getByRole("button", { name: "Ustvari vizualno podobo" }).click();
  await expect(design.getByTestId("design-templates").getByRole("img").first()).toBeVisible({ timeout: 30_000 });
  await p.goto(adUrl);
  const creatives = p.getByTestId("creatives");
  await expect(creatives.getByTestId("creatives-estimate")).toContainText("~3 AI ilustracij · največ");
  await creatives.getByRole("button", { name: "Ustvari slike" }).click();
  await expect(p.getByTestId("creatives-status")).toHaveText("Pripravljene", { timeout: 45_000 });
  for (const [key, w] of [["fb_feed_portrait", 1080], ["gdn_responsive_landscape", 1200]] as const) {
    const imgs = p.getByTestId(`placement-${key}`).getByRole("img");
    await expect(imgs).toHaveCount(3);
    await expect.poll(() => imgs.first().evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth), { timeout: 15_000 }).toBe(w);
  }
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("ad-creatives.png"), fullPage: true });
  // Words on the creatives, redrawn without a new illustration.
  const falBefore = (await (await fetch("http://127.0.0.1:3199/fal-log")).json()).length;
  await p.getByTestId("creative-texts").getByLabel("Naslov · 1").fill("Popravljen *naslov*");
  await p.getByRole("button", { name: "Shrani in osveži" }).click();
  await expect(p.getByTestId("creatives-status")).toHaveText("Pripravljene", { timeout: 30_000 });
  await expect(p.getByTestId("creative-texts").getByLabel("Naslov · 1")).toHaveValue("Popravljen *naslov*");
  expect((await (await fetch("http://127.0.0.1:3199/fal-log")).json()).length).toBe(falBefore);
  // The whole ad set as a ZIP: copy.csv + a folder per placement.
  const [zip] = await Promise.all([p.waitForEvent("download"), p.getByTestId("ad-zip").click()]);
  const names = unzip(new Uint8Array(fs.readFileSync((await zip.path())!))).map((e) => e.name);
  expect(names[0]).toBe("copy.csv");
  expect(names.filter((n) => n.endsWith(".png"))).toHaveLength(4 * 3);
  expect(names).toContain("gdn_responsive_square/tecaj_brezplacen-webinar-v-cetrtek_gdn_responsive_square_v2.png");

  // Nothing disappears (TASK-034): the creatives before the redraw are an earlier version — restore it.
  const cv = p.getByTestId("creative-versions");
  await cv.getByText("Prejšnje verzije kreativ (1)").click();
  await expect(cv.getByTestId("creative-version").getByRole("img")).toHaveCount(4 * 3);
  await cv.getByRole("button", { name: "Vrni to verzijo" }).click();
  await expect(p.getByTestId("creative-texts").getByLabel("Naslov · 1")).not.toHaveValue("Popravljen *naslov*");
  await expect(p.getByTestId("creative-versions")).toContainText("Prejšnje verzije kreativ (1)");
  // Earlier copy: both saves kept the copy they replaced; restore the first one, delete the other on purpose.
  const copyVersions = p.getByTestId("copy-versions");
  await copyVersions.getByText("Prejšnja besedila (2)").click();
  await copyVersions.getByTestId("copy-version").last().getByRole("button", { name: "Vrni to verzijo" }).click();
  await expect(p.getByTestId("variant-1").getByLabel("Naslov", { exact: true })).toHaveValue("Naslov 1");
  await expect(p.getByTestId("copy-versions")).toContainText("Prejšnja besedila (2)");
  await p.getByTestId("copy-versions").evaluate((el) => el.setAttribute("open", ""));
  const doomed = p.getByTestId("copy-versions").getByTestId("copy-version").first();
  await doomed.locator("summary", { hasText: "Izbriši verzijo" }).click();
  await doomed.getByRole("button", { name: "Izbriši verzijo" }).click();
  await expect(p.getByTestId("copy-versions")).toContainText("Prejšnja besedila (1)");
  expect(await serious(p)).toEqual([]);

  // Back on the brand: the ad set in the list.
  await p.getByRole("link", { name: /Tečaj · Oglasi/ }).click();
  await expect(p.getByTestId("ad-sets")).toContainText("Brezplačen webinar v četrtek");
  await ctx.close();
});
