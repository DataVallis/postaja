import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { image, makeFont, pdf } from "../fixtures/files";

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
  const brandUrl = p.url();

  // Logo: a PDF is refused, a JPEG is stored (as PNG) and shown.
  await p.getByLabel("Naloži logotip").setInputFiles(file("logo.png", "image/png", pdf("not an image")));
  await p.getByRole("button", { name: "Naloži", exact: true }).first().click();
  await expect(p.getByRole("alert").filter({ hasText: "logo.png: ta vrsta datoteke tukaj ni podprta." })).toBeVisible();
  await p.getByLabel("Naloži logotip").setInputFiles(file("logo.jpg", "image/jpeg", await image("jpeg", 240, 80)));
  await p.getByRole("button", { name: "Naloži", exact: true }).first().click();
  await expect(p.getByRole("img", { name: "Logotip logo.jpg" })).toBeVisible();
  await expect.poll(() => p.getByRole("img", { name: "Logotip logo.jpg" }).evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(240);

  // Fonts: one without diacritics is refused, a complete one is listed with its family.
  await p.getByLabel("Naloži fonte").setInputFiles([
    file("Brez.ttf", "font/ttf", makeFont({ chars: "abc" })),
    file("Brand.ttf", "font/ttf", makeFont({ chars: "abcčšžćđČŠŽĆĐ", family: "Brand Sans" })),
  ]);
  await p.getByRole("button", { name: "Naloži", exact: true }).nth(1).click();
  await expect(p.getByRole("alert").filter({ hasText: "Brez.ttf: font nima znakov: č š ž ć đ Č Š Ž Ć Đ." })).toBeVisible();
  await expect(p.getByTestId("fonts")).toContainText("Brand Sans");
  await expect(p.getByTestId("fonts")).toContainText("vsi šumniki");

  // Sources: PDF + CSV, then the same PDF again is a duplicate.
  const brief = pdf("brief");
  await p.getByLabel("Naloži vire").setInputFiles([
    file("Brief – č.pdf", "application/pdf", brief),
    file("izdelki.csv", "text/csv", new TextEncoder().encode("ime;cena\nčaj;3\n")),
  ]);
  await p.getByRole("button", { name: "Naloži", exact: true }).nth(2).click();
  await expect(p.getByTestId("sources")).toContainText("Brief – č.pdf");
  await expect(p.getByTestId("sources")).toContainText("CSV");
  await expect(p.getByTestId("sources")).toContainText("naloženo");
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("brand-files.png"), fullPage: true });

  await p.getByLabel("Naloži vire").setInputFiles(file("again.pdf", "application/pdf", brief));
  await p.getByRole("button", { name: "Naloži", exact: true }).nth(2).click();
  await expect(p.getByRole("alert").filter({ hasText: "again.pdf: ta datoteka je že naložena." })).toBeVisible();

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
  await ctx.close();
});

test("anonymous requests to file routes get 401", async ({ request }) => {
  expect((await request.get("/api/brand-files/source/x", { maxRedirects: 0 })).status()).toBe(401);
  expect((await request.post("/api/brands/x/files?slot=source", { headers: { origin: "http://127.0.0.1:3100" }, multipart: { file: { name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1") } } })).status()).toBe(401);
});
