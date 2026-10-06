import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { compress } from "wawoff2";
import { image, makeFont, makeXlsx, makeZipEntries, pdf } from "../fixtures/files";

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
const file = (name: string, mimeType: string, bytes: Uint8Array) => ({ name, mimeType, buffer: Buffer.from(bytes) });

test("owner uploads logo, font and sources, downloads and deletes; wrong files are refused; other orgs get 404", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one full flow is enough");
  const stamp = Date.now();
  const owner = `files-owner-${stamp}@example.test`;

  await signIn(page, "e2e-root@example.test");
  await page.goto("/admin/orgs/new");
  await page.getByLabel("Ime", { exact: true }).fill("Datoteke E2E");
  await page.getByLabel("Kratko ime (slug)").fill(`datoteke-${stamp}`);
  await page.getByLabel("E-pošta lastnika").fill(owner);
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: "Datoteke E2E" })).toBeVisible();
  const outsider = `files-other-${stamp}@example.test`;
  await page.goto("/admin/orgs/new");
  await page.getByLabel("Ime", { exact: true }).fill("Druga E2E");
  await page.getByLabel("Kratko ime (slug)").fill(`druga-${stamp}`);
  await page.getByLabel("E-pošta lastnika").fill(outsider);
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: "Druga E2E" })).toBeVisible();

  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await signIn(p, owner);
  await p.goto("/app/brands/new");
  await p.getByLabel("Ime", { exact: true }).fill("Inženirji");
  await p.getByLabel("Kratko ime (slug)").fill("inzenirji");
  await p.getByRole("button", { name: "Ustvari" }).click();
  await expect(p.getByRole("heading", { name: "Inženirji", level: 1 })).toBeVisible();
  await expect(p.getByRole("heading", { name: "Datoteke branda" })).toBeVisible();
  await expect(p.getByTestId("dropzone")).toContainText("Fonti morajo imeti č, š, ž, ć in đ.");
  const brandUrl = p.url();

  // One ZIP with a whole brand folder: every entry is sorted (logo, WOFF2 font → TTF, PDF source), SVG is refused.
  const tiny = new Uint8Array(fs.readFileSync("tests/fixtures/fonts/TinySans.ttf"));
  const brief = pdf("brief");
  const zip = makeZipEntries([
    { name: "Brand/Logo.png", bytes: await image("png", 240, 80) },
    { name: "Brand/TinySans.woff2", bytes: await compress(tiny) },
    { name: "Brand/Brief – č.pdf", bytes: brief, deflate: true },
    { name: "Brand/icon.svg", bytes: new TextEncoder().encode("<svg/>") },
    { name: "Brand/Cenik.xlsx", bytes: makeXlsx([{ name: "Cenik", rows: [["Tečaj", 149]] }]) },
  ]);
  await p.getByLabel("Izberi datoteke").setInputFiles(file("brand.zip", "application/zip", zip));
  const log = p.getByTestId("upload-log");
  await expect(log.getByRole("status").filter({ hasText: "Brand/Logo.png" })).toContainText("logotip");
  await expect(log.getByRole("status").filter({ hasText: "Brand/TinySans.woff2" })).toContainText("font");
  await expect(log.getByRole("status").filter({ hasText: "Brand/Brief – č.pdf" })).toContainText("vir");
  await expect(log.getByRole("alert").filter({ hasText: "Brand/icon.svg" })).toContainText("te vrste datoteke ne sprejemamo");
  await expect(p.getByRole("img", { name: "Logotip Logo.png" })).toBeVisible();
  await expect.poll(() => p.getByRole("img", { name: "Logotip Logo.png" }).evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(240);
  await expect(p.getByTestId("fonts")).toContainText("Tiny Sans");
  await expect(p.getByTestId("fonts")).toContainText("vsi šumniki so na voljo");
  await expect(p.getByTestId("sources")).toContainText("Brief – č.pdf");
  // Knowledge base (TASK-009): document text is read at upload; the fake PDF has none.
  const row = (name: string) => p.getByTestId("sources").getByRole("row").filter({ hasText: name });
  await expect(row("Cenik.xlsx").getByTestId("source-text")).toHaveText("20 znakov besedila");
  await expect(row("Brief – č.pdf").getByTestId("source-text")).toHaveText("datoteke ni bilo mogoče prebrati");

  // Real drag and drop onto the zone: a CSV source.
  await p.getByTestId("dropzone").evaluate((zone) => {
    const dt = new DataTransfer();
    dt.items.add(new File(["ime;cena\nčaj;3\n"], "izdelki.csv", { type: "text/csv" }));
    zone.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await expect(log.getByRole("status").filter({ hasText: "izdelki.csv" })).toContainText("vir");
  await expect(p.getByTestId("sources")).toContainText("CSV");
  await expect(row("izdelki.csv").getByTestId("source-text")).toHaveText("14 znakov besedila");

  // A font without diacritics is refused for this Slovenian brand; the same PDF again is a duplicate.
  await p.getByLabel("Izberi datoteke").setInputFiles([
    file("Brez.ttf", "font/ttf", makeFont({ chars: "abc" })),
    file("again.pdf", "application/pdf", brief),
  ]);
  await expect(log.getByRole("alert").filter({ hasText: "Brez.ttf" })).toContainText("font nima znakov č š ž ć đ Č Š Ž Ć Đ.");
  await expect(log.getByRole("alert").filter({ hasText: "again.pdf" })).toContainText("ta datoteka je že naložena.");

  // "Dodaj logotip" forces the logo slot for an image without "logo" in its name.
  await p.getByLabel("Dodaj logotip").setInputFiles(file("photo.jpg", "image/jpeg", await image("jpeg", 90, 90)));
  await expect(p.getByRole("img", { name: "Logotip photo.jpg" })).toBeVisible();
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("brand-files.png"), fullPage: true });

  // Download: the link redirects to a short-lived URL that serves exactly the uploaded bytes.
  const href = await p.getByRole("link", { name: "Brief – č.pdf" }).getAttribute("href");
  const res = await p.request.get(href!);
  expect(res.status()).toBe(200);
  expect(new Uint8Array(await res.body())).toEqual(brief);
  expect(res.headers()["content-disposition"]).toContain("filename*=UTF-8''Brief%20%E2%80%93%20%C4%8D.pdf");

  // Another organization's owner cannot see or download it.
  const other = await browser.newContext();
  const o = await other.newPage();
  await signIn(o, outsider); // owner of a different organization
  expect((await o.request.get(href!, { maxRedirects: 0 })).status()).toBe(404);
  expect((await o.goto(brandUrl))?.status()).toBe(404);
  await other.close();

  // Delete the CSV.
  await p.getByRole("button", { name: "Izbriši izdelki.csv" }).click();
  await expect(p.getByTestId("sources")).not.toContainText("izdelki.csv");
  await expect(p.getByTestId("sources")).toContainText("Brief – č.pdf");

  // An English-only brand: no diacritics requirement, and channels can only be English.
  await p.goto("/app/brands/new");
  await p.getByLabel("Ime", { exact: true }).fill("AI Builders");
  await p.getByLabel("Kratko ime (slug)").fill("aibuilders");
  await p.getByLabel("slovenščina").uncheck();
  await p.getByLabel("angleščina").check();
  await p.getByRole("button", { name: "Ustvari" }).click();
  await expect(p.getByRole("heading", { name: "AI Builders", level: 1 })).toBeVisible();
  await expect(p.getByTestId("dropzone")).not.toContainText("č, š, ž");
  await expect(p.getByLabel("Jezik", { exact: true })).toHaveValue("en");
  expect(await p.getByLabel("Jezik", { exact: true }).locator("option").allTextContents()).toEqual(["angleščina"]);
  await p.screenshot({ path: info.outputPath("brand-files-en.png"), fullPage: true });
  await ctx.close();
});

test("anonymous requests to file routes get 401", async ({ request }) => {
  expect((await request.get("/api/brand-files/source/x", { maxRedirects: 0 })).status()).toBe(401);
  expect((await request.post("/api/brands/x/files?slot=source", { headers: { origin: "http://127.0.0.1:3100" }, multipart: { file: { name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1") } } })).status()).toBe(401);
});
