import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

// Persona (TASK-024): the owner describes a person, Claude fills in the DNA framework, Postaja makes the passport
// (one photoreal passport close-up from the whole DNA), the owner edits and uploads.
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
type FalCall = { model: string; references: number; prompt?: string };
const falLog = async (): Promise<FalCall[]> => (await fetch("http://127.0.0.1:3199/fal-log")).json();

test("persona: AI fills in the DNA, the passport is generated from it, the owner edits and uploads; a post gets a persona video", async ({ page, browser }, info) => {
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
  const tab = (name: string) => p.getByRole("navigation", { name: "Razdelki branda" }).getByRole("link", { name }).click();
  await tab("Persona");
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

  // The passport: one photoreal close-up from the whole DNA (Nano Banana Pro).
  const before = (await falLog()).length;
  await p.getByRole("button", { name: /Ustvari passport sliko · največ 0\.15 €/ }).click();
  await expect(p.getByTestId("passport-status")).toHaveText("Pripravljeno", { timeout: 60_000 });
  const images = p.getByTestId("passport-images").getByRole("listitem");
  await expect(images).toHaveCount(1);
  await expect(images.first()).toContainText("Spredaj (passport) · glavna");
  const calls = (await falLog()).slice(before);
  expect(calls.map((c) => [c.model, c.references])).toEqual([["fal-ai/nano-banana-pro", 0]]);
  expect(calls[0].prompt).toContain("Hair Colour: Jet black");
  expect(calls[0].prompt).toContain("Pose / Action: Walking, looking back");
  expect(calls[0].prompt).toContain("Passport-style close-up");
  await expect.poll(() => images.first().getByRole("img").evaluate((e: HTMLImageElement) => e.naturalWidth)).toBeGreaterThan(0);
  await expect(p.getByTestId("passport-generate")).toHaveText(/Nova passport slika/);
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("persona.png"), fullPage: true });

  // Persona in post images (TASK-027): on by default once there is a picture; the owner can switch it off and on.
  const inPosts = p.getByTestId("persona-in-posts");
  await expect(inPosts).toContainText("vklopljeno");
  await inPosts.getByRole("button", { name: "Izklopi" }).click();
  // Wait for the new page (the hint text itself contains "vklopljeno"), not just for a word.
  await expect(p.getByTestId("persona-in-posts").getByRole("button", { name: "Vklopi" })).toBeVisible();
  await expect(p.getByTestId("persona-in-posts")).toContainText("izklopljeno");
  await p.getByTestId("persona-in-posts").getByRole("button", { name: "Vklopi" }).click();
  await expect(p.getByTestId("persona-in-posts").getByRole("button", { name: "Izklopi" })).toBeVisible();

  // The owner edits a field; uploads a picture of their own and makes it the primary.
  await dna.getByLabel("Hair Colour *").fill("Platinum blonde");
  await p.getByRole("button", { name: "Shrani DNK" }).click();
  await expect(p.getByText("DNK shranjena.")).toBeVisible();
  await expect(p.getByTestId("persona-dna").getByLabel("Hair Colour *")).toHaveValue("Platinum blonde");
  const photo = await sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: 30, g: 160, b: 90 } } }).jpeg().toBuffer();
  await p.getByLabel("Naloži slike").setInputFiles({ name: "moja.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(images).toHaveCount(2);
  await expect(p.getByText("moja.jpg — dodano")).toBeVisible();
  await images.last().getByRole("button", { name: "Nastavi kot glavno" }).click();
  await expect(images.first()).toContainText("Drugo · glavna");
  await expect(images.first()).not.toContainText("Spredaj");

  // A post of the persona brand gets a video with the persona: Claude's shot → first frame from the passport → Kling 3.0.
  await tab("Kanali");
  await p.getByLabel("Platforma").selectOption("instagram");
  await p.getByLabel("Profil (@ime)").fill("@mila");
  await p.getByRole("button", { name: "Dodaj kanal" }).click();
  await tab("Objave");
  await p.getByLabel("Kaj objavimo?").fill("Deževen dan v Ljubljani");
  await p.getByRole("button", { name: "Ustvari objavo" }).click();
  await expect(p).toHaveURL(/\/app\/posts\//);
  // The Persona tab links to the brand's posts, where the video is made.
  const postUrl = p.url();
  await p.getByRole("link", { name: "← Mila AI" }).click();
  await tab("Persona");
  await p.getByTestId("persona-videos").getByRole("link", { name: "Deževen dan v Ljubljani" }).click();
  await expect(p).toHaveURL(`${postUrl}#persona-video`);
  const pv = p.getByTestId("persona-video");
  await expect(pv.getByRole("heading")).toContainText("Video s persono (Mila)");
  await expect(p.getByTestId("images-persona")).toHaveCount(0); // no visual identity yet → no image form; covered in design.int.test
  await expect(pv.getByLabel("Dolžina").locator("option")).toHaveText([/^5 s · največ [\d.]+ €$/, /^10 s · največ [\d.]+ €$/]);
  await pv.getByLabel("Navodila za prizor (neobvezno)").fill("z dežnikom");
  const falBefore = (await falLog()).length;
  await pv.getByRole("button", { name: "Ustvari video s persono" }).click();
  await expect(p.getByTestId("persona-video-status")).toHaveText("Pripravljen", { timeout: 90_000 });
  const vcalls = (await falLog()).slice(falBefore) as (FalCall & { video?: boolean; duration?: string })[];
  expect(vcalls.map((c) => c.model)).toEqual(["fal-ai/nano-banana-pro/edit", "fal-ai/kling-video/v3/standard/image-to-video"]);
  expect(vcalls[0].references).toBe(2);
  expect(vcalls[0].prompt).toContain("SAME person as in the reference images");
  expect(vcalls[0].prompt).toContain("z dežnikom");
  expect(vcalls[1].duration).toBe("5");
  const items = p.getByTestId("persona-videos-item");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("Turns to the camera and smiles");
  await expect(items.first().getByLabel("Video s persono Mila")).toHaveAttribute("poster", /\/api\/post-videos\/.*\?poster=1$/);
  const [download] = await Promise.all([p.waitForEvent("download"), p.getByTestId("persona-videos-download").click()]);
  expect(download.suggestedFilename()).toMatch(/\.mp4$/);
  expect(await serious(p)).toEqual([]);
  await p.screenshot({ path: info.outputPath("persona-video.png"), fullPage: true });
  await ctx.close();
});
