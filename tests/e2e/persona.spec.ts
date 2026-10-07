import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

// Persona (TASK-024): the owner describes a person, Claude fills in the DNA framework, Postaja makes the passport
// (the first picture from the whole DNA, the other angles with that picture as reference), the owner edits and uploads.
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
type FalCall = { model: string; references: number; prompt?: string };
const falLog = async (): Promise<FalCall[]> => (await fetch("http://127.0.0.1:3199/fal-log")).json();

test("persona: AI fills in the DNA, the passport is generated from it, the owner edits and uploads", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one full flow is enough");
  test.setTimeout(150_000);
  const stamp = Date.now();
  const owner = `persona-${stamp}@example.test`;
  await signIn(page, "e2e-root@example.test");
  await page.goto("/admin/orgs/new");
  await page.getByLabel("Ime", { exact: true }).fill("Persona E2E");
  await page.getByLabel("Kratko ime (slug)").fill(`persona-${stamp}`);
  await page.getByLabel("E-pošta lastnika").fill(owner);
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: "Persona E2E" })).toBeVisible();

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await signIn(p, owner);
  await p.goto("/app/brands/new");
  await p.getByLabel("Ime", { exact: true }).fill("Mila AI");
  await p.getByRole("button", { name: "Ustvari" }).click();
  await expect(p.getByRole("heading", { name: "Mila AI", level: 1 })).toBeVisible();
  await p.getByRole("navigation", { name: "Razdelki branda" }).getByRole("link", { name: "Persona" }).click();
  await expect(p.getByTestId("persona-manual")).toBeVisible();
  expect(await serious(p)).toEqual([]);

  // A rough description → Claude fills in all 13 fields.
  const ai = p.getByTestId("persona-ai");
  await ai.getByLabel("Opis osebe ali obstoječa DNK").fill("26-letna Ljubljančanka, kratki črni lasje, vedno v rumeni jakni");
  await ai.getByRole("button", { name: /Izpolni DNK z AI · največ [\d.,]+ €/ }).click();
  await expect(p.getByRole("heading", { name: "Mila", level: 2 })).toBeVisible();
  const dna = p.getByTestId("persona-dna");
  await expect(dna.getByLabel("Hair Colour *")).toHaveValue("Jet black");
  await expect(dna.getByLabel("Extra Notes")).toHaveValue(/26-letna Ljubljančanka/);
  await expect(p.getByTestId("passport-status")).toHaveText("Ni slik");

  // The passport: one picture from the DNA, then 4 angles from it.
  const before = (await falLog()).length;
  await p.getByTestId("passport-generate").click();
  await expect(p.getByTestId("passport-status")).toHaveText("Pripravljeno", { timeout: 60_000 });
  const images = p.getByTestId("passport-images").getByRole("listitem");
  await expect(images).toHaveCount(5);
  await expect(images.first()).toContainText("Spredaj (passport) · glavna");
  const calls = (await falLog()).slice(before);
  expect(calls.map((c) => [c.model, c.references])).toEqual([
    ["fal-ai/flux-pro/v1.1", 0], ["fal-ai/nano-banana/edit", 1], ["fal-ai/nano-banana/edit", 2], ["fal-ai/nano-banana/edit", 3], ["fal-ai/nano-banana/edit", 4],
  ]);
  expect(calls[0].prompt).toContain("Hair Colour: Jet black");
  expect(calls[0].prompt).toContain("Passport-style portrait");
  for (const img of await p.getByTestId("passport-images").getByRole("img").all()) await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBeGreaterThan(0);
  await expect(p.getByTestId("passport-generate")).toHaveCount(0);
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("persona.png"), fullPage: true });

  // The owner edits a field; uploads a picture of their own and makes it the primary.
  await dna.getByLabel("Hair Colour *").fill("Platinum blonde");
  await p.getByRole("button", { name: "Shrani DNK" }).click();
  await expect(p.getByText("DNK shranjena.")).toBeVisible();
  await expect(p.getByTestId("persona-dna").getByLabel("Hair Colour *")).toHaveValue("Platinum blonde");
  const photo = await sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: 30, g: 160, b: 90 } } }).jpeg().toBuffer();
  await p.getByLabel("Naloži slike").setInputFiles({ name: "moja.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(images).toHaveCount(6);
  await expect(p.getByText("moja.jpg — dodano")).toBeVisible();
  await images.last().getByRole("button", { name: "Nastavi kot glavno" }).click();
  await expect(images.first()).toContainText("Drugo · glavna");
  await expect(images.first()).not.toContainText("Spredaj");
  await ctx.close();
});
