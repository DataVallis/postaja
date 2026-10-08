import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { expect, test, type Page } from "@playwright/test";
import { todayIn } from "../../src/lib/dates";
import { makeXlsx } from "../fixtures/files";
import { unzip } from "../../src/server/files/zip";

// Brand visual identity and post images (TASK-017): Claude designs the brand's templates from the description and past
// posts, the owner revises them in words and can go back a version; images for a planned post (template + words by
// Claude, illustration by the fal stand-in with the examples as reference, drawn by Postaja), download, word edits
// redrawn for free, and bulk images (a carousel) for a day.
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

test("images: brand design by Claude, revision, versions, a post's images, word edits, bulk carousel", async ({ page, browser }, info) => {
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
  // Edit the channel: the language list and the handle are changeable afterwards.
  await p.getByTestId("channels").getByRole("button", { name: "Uredi kanal" }).click();
  const edit = p.getByTestId("channel-edit");
  await edit.getByLabel("Profil (@ime)").fill("@cherr.io");
  await edit.getByRole("button", { name: "Shrani kanal" }).click();
  await expect(edit.getByRole("status")).toHaveText("Kanal je shranjen.");
  await expect(p.getByTestId("channels")).toContainText("instagram · @cherr.io");
  // A logo and two past posts (the brand's examples).
  await tab("Datoteke");
  const logo = await sharp({ create: { width: 800, height: 200, channels: 4, background: "#ffffff" } }).png().toBuffer();
  await p.getByLabel("Dodaj logotip").setInputFiles({ name: "cherr-logo.png", mimeType: "image/png", buffer: logo });
  await expect(p.getByTestId("logo-frame")).toHaveCount(1);
  const past = (bg: string) => sharp({ create: { width: 1080, height: 1350, channels: 3, background: bg } }).png().toBuffer();
  await p.getByLabel("Izberi datoteke").setInputFiles([
    { name: "objava-1.png", mimeType: "image/png", buffer: await past("#2a0a12") },
    { name: "objava-2.png", mimeType: "image/png", buffer: await past("#0a122a") },
  ]);
  await expect(p.getByText("objava-2.png").first()).toBeVisible();

  // Visual identity: Claude designs it from the description and the examples; the owner corrects it in words.
  await tab("Vizualna podoba");
  const design = p.getByTestId("design");
  await expect(design.getByTestId("design-inputs")).toContainText("2 primera preteklih objav");
  await design.getByLabel("Kako naj grafike izgledajo?").fill("Temne kartice, rdeč poudarek, bel naslov, noga z logom.");
  await design.getByRole("button", { name: "Ustvari vizualno podobo" }).click();
  const templates = design.getByTestId("design-templates").getByRole("img");
  await expect(templates).toHaveCount(2, { timeout: 30_000 });
  for (const img of await templates.all()) await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(540);
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("design.png"), fullPage: true });
  await design.getByLabel("Kaj naj spremenim?").fill("naslov večji");
  await design.getByRole("button", { name: "Popravi" }).click();
  await expect(design.getByTestId("design-summary")).toContainText("Popravek: naslov večji", { timeout: 30_000 });
  await expect(design.getByTestId("design-summary")).toContainText("Verzija 2");
  const versions = design.getByTestId("design-versions");
  await expect(versions.getByRole("row")).toHaveCount(3);
  await versions.getByRole("row", { name: /v1/ }).getByRole("button", { name: "Uporabi" }).click();
  await expect(design.getByTestId("design-summary")).toContainText("Verzija 1");
  // Square previews.
  await design.getByRole("navigation", { name: "Oblika predogleda" }).getByRole("link", { name: "1:1" }).click();
  await expect.poll(() => templates.first().evaluate((el: HTMLImageElement) => el.complete && el.naturalHeight)).toBe(540);

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

  // The image post: Claude picks the template and words, fal makes the illustration with the examples as style reference.
  await p.getByRole("link", { name: /Zaklep|Daš/ }).first().click();
  const images = p.getByTestId("images");
  await expect(images.getByTestId("images-status")).toHaveText("Ni slik");
  await images.getByRole("button", { name: "Ustvari slike" }).click();
  await expect(images.getByTestId("images-status")).toHaveText("Pripravljene", { timeout: 30_000 });
  const img = images.getByTestId("image-list").getByRole("img");
  await expect(img).toHaveCount(1);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(1080);
  const falLog = await (await fetch("http://127.0.0.1:3199/fal-log")).json();
  expect(falLog.at(-1)).toMatchObject({ model: "fal-ai/ideogram/v3", references: 2 });
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("post-images.png"), fullPage: true });
  const [download] = await Promise.all([p.waitForEvent("download"), images.getByTestId("image-download").first().click()]);
  expect(download.suggestedFilename()).toBe(`cherr-${today}-1.png`);
  const file = fs.readFileSync((await download.path())!);
  expect(await sharp(file).metadata()).toMatchObject({ format: "png", width: 1080, height: 1350 });

  // Correct the words; they are redrawn on the same illustration.
  const oldSrc = await img.getAttribute("src");
  const headline = images.getByTestId("slide-texts").getByLabel("Naslov");
  await expect(headline).toHaveValue("Daš. Zaklenjeno je.\nIzplača se v korakih.");
  await headline.fill("Nov naslov.\n*Še ena vrstica.*");
  await images.getByRole("button", { name: "Shrani in osveži" }).click();
  await expect(images.getByTestId("images-status")).toHaveText("Pripravljene", { timeout: 30_000 });
  await expect.poll(() => images.getByTestId("image-list").getByRole("img").getAttribute("src")).not.toBe(oldSrc);
  await expect(images.getByTestId("slide-texts").getByLabel("Naslov")).toHaveValue("Nov naslov.\n*Še ena vrstica.*");
  expect((await (await fetch("http://127.0.0.1:3199/fal-log")).json()).length).toBe(falLog.length); // no new illustration

  // A correction in words for the AI (owner, 2026-10-07): Claude sees the images and changes only what was asked.
  const revise = images.getByTestId("image-revise");
  await revise.getByLabel("Kaj naj AI popravi na slikah?").fill("Naslov: Krajši naslov.");
  expect(await serious(p)).toEqual([]);
  await revise.getByRole("button", { name: "Popravi slike" }).click();
  await expect(images.getByTestId("images-status")).toHaveText("Pripravljene", { timeout: 30_000 });
  await expect(images.getByTestId("slide-texts").getByLabel("Naslov")).toHaveValue("Krajši naslov.");
  await expect(images.getByTestId("image-revision")).toHaveText("Zadnji popravek: Naslov: Krajši naslov.");
  expect((await (await fetch("http://127.0.0.1:3199/fal-log")).json()).length).toBe(falLog.length); // words only: no new illustration
  await revise.getByLabel("Kaj naj AI popravi na slikah?").fill("Ilustracija naj bo svetlejša.");
  await revise.getByRole("button", { name: "Popravi slike" }).click();
  await expect.poll(async () => (await (await fetch("http://127.0.0.1:3199/fal-log")).json()).length, { timeout: 30_000 }).toBe(falLog.length + 1);
  await expect(images.getByTestId("images-status")).toHaveText("Pripravljene", { timeout: 30_000 });
  // TASK-033: every earlier run is kept as a version; the oldest one can be restored and the words come back with it.
  const imgVersions = images.getByTestId("image-versions");
  await expect(imgVersions.getByText(/^Prejšnje verzije slik \(\d+\)$/)).toBeVisible();
  await imgVersions.getByText(/^Prejšnje verzije slik/).click();
  const count = await imgVersions.getByTestId("image-version").count();
  expect(count).toBeGreaterThanOrEqual(3);
  await imgVersions.getByTestId("image-version").last().getByRole("button", { name: "Vrni to verzijo" }).click();
  await expect(p.getByTestId("image-versions").getByText(`Prejšnje verzije slik (${count})`)).toBeVisible();
  await expect(images.getByTestId("slide-texts").getByLabel("Naslov")).not.toHaveValue("Krajši naslov.");

  // Animation (TASK-023): Claude designs the motion, Postaja draws every frame — no video model, nothing from fal.
  const anim = p.getByTestId("animation");
  const falBeforeAnim = (await (await fetch("http://127.0.0.1:3199/fal-log")).json()).length;
  await anim.getByLabel("Navodila za animacijo (neobvezno)").fill("Naslov besedo za besedo, logotip na koncu.");
  expect(await serious(p)).toEqual([]);
  await anim.getByRole("button", { name: /^Animiraj · največ \d+\.\d\d €$/ }).click();
  await expect(p.getByTestId("animation-status")).toHaveText("Pripravljene", { timeout: 90_000 });
  // The test Chromium has no H.264 decoder (Chrome and Safari do), so the file itself is checked with ffprobe.
  await expect(anim.getByTestId("animation-videos").getByLabel("Animacija slike 1")).toHaveAttribute("src", /^\/api\/post-videos\//);
  expect((await (await fetch("http://127.0.0.1:3199/fal-log")).json()).length).toBe(falBeforeAnim);
  const [mp4] = await Promise.all([p.waitForEvent("download"), anim.getByTestId("animation-videos-download").click()]);
  expect(mp4.suggestedFilename()).toMatch(/^cherr-.*-animacija-\d{8}-\d{4}\.mp4$/);
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration", "-of", "json", (await mp4.path())!]).toString());
  expect(probe.streams).toEqual(expect.arrayContaining([
    expect.objectContaining({ codec_type: "video", codec_name: "h264", width: 1080, height: 1350 }), expect.objectContaining({ codec_type: "audio", codec_name: "aac" }),
  ]));
  expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(3.9);
  await p.screenshot({ path: info.outputPath("animation.png"), fullPage: true });
  // TASK-032: a second animation is added next to the first; one can be deleted on purpose.
  await anim.getByRole("button", { name: /^Nova animacija/ }).click();
  await expect(p.getByTestId("animation-videos-item")).toHaveCount(2, { timeout: 90_000 });
  const second = p.getByTestId("animation-videos-item").first();
  await second.getByText("Izbriši", { exact: true }).click();
  await second.getByRole("button", { name: "Izbriši video" }).click();
  await expect(p.getByTestId("animation-videos-item")).toHaveCount(1);

  // Bulk: the day's remaining post (the carousel) gets its images from the plan view.
  await p.goto(`/app/plan?view=day&d=${today}`);
  await p.getByTestId("day-bulk").getByRole("button", { name: "Ustvari slike (1)" }).click();
  // The preview prices the carousel: 3 slides (+ a possible cover) with the style-reference model (past posts exist).
  await expect(p.getByTestId("estimate-image-count")).toContainText("1 objava · ~3 slik");
  await expect(p.getByTestId("bulk-estimate")).toContainText("Ideogram");
  await p.getByRole("button", { name: /^Začni \(1\)/ }).click();
  await expect(p).toHaveURL(/tab=runs/);
  await expect(p.getByTestId("bulk-runs").getByTestId("run-counts").first()).toHaveText("1 / 1 končanih", { timeout: 30_000 });
  await p.goto(`/app/plan?view=day&d=${today}`);
  await p.getByTestId("plan-day").getByRole("link", { name: /Koraki|Prvi korak/ }).first().click();
  await expect(p.getByTestId("images").getByTestId("image-list").getByRole("img")).toHaveCount(4); // cover + 3 slides
  // Every image of the carousel can be animated, the text-only slides too.
  await expect(p.getByTestId("animation").getByLabel("Katera slika").locator("option")).toHaveCount(4);
  await expect(p.getByTestId("carousel-pdf")).toHaveCount(0); // an Instagram carousel is images, not a PDF document

  // One click: this post as a ZIP (images in order), then the whole day with its overview (TASK-016).
  const [postZip] = await Promise.all([p.waitForEvent("download"), p.getByTestId("post-zip").click()]);
  expect(postZip.suggestedFilename()).toMatch(/^cherr-.*\.zip$/);
  expect(unzip(new Uint8Array(fs.readFileSync((await postZip.path())!))).map((e) => e.name)).toEqual(["1.png", "2.png", "3.png", "4.png"]);
  await p.goto(`/app/plan?view=day&d=${today}`);
  const [dayZip] = await Promise.all([p.waitForEvent("download"), p.getByTestId("day-zip").click()]);
  expect(dayZip.suggestedFilename()).toBe(`postaja-${today}.zip`);
  const names = unzip(new Uint8Array(fs.readFileSync((await dayZip.path())!))).map((e) => e.name);
  expect(names[0]).toBe("pregled.csv");
  expect(names.filter((n) => n.endsWith(".png"))).toHaveLength(5); // 1 image post + 4 carousel images
  await ctx.close();
});
