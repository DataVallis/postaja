import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { makeDocx } from "../fixtures/files";

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

test("owner imports the CGP verbatim from a Word file and from an uploaded PDF, then saves a version", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one full flow is enough");
  const stamp = Date.now();
  const owner = `cgp-owner-${stamp}@example.test`;
  await signIn(page, "e2e-root@example.test");
  await page.goto("/admin/orgs/new");
  await page.getByLabel("Ime", { exact: true }).fill("CGP E2E");
  await page.getByLabel("Kratko ime (slug)").fill(`cgp-${stamp}`);
  await page.getByLabel("E-pošta lastnika").fill(owner);
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: "CGP E2E" })).toBeVisible();

  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await signIn(p, owner);
  await p.goto("/app/brands/new");
  await p.getByLabel("Ime", { exact: true }).fill("Inženirji");
  await p.getByLabel("Kratko ime (slug)").fill("inzenirji");
  await p.getByRole("button", { name: "Ustvari" }).click();
  await expect(p.getByRole("heading", { name: "Inženirji", level: 1 })).toBeVisible();

  // From the computer: a Word file.
  const docx = makeDocx([{ text: "Kdo smo", style: "Naslov1" }, { text: "Inženirji za inženirje." }, { text: "brez žargona", list: true }]);
  await p.getByLabel("Uvozi iz dokumenta").setInputFiles({ name: "CGP.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from(docx) });
  await expect(p.getByRole("status").filter({ hasText: "Besedilo iz »CGP.docx« je vstavljeno" })).toBeVisible();
  await expect(p.getByLabel("CGP — navodila za AI")).toHaveValue("# Kdo smo\nInženirji za inženirje.\n- brez žargona");
  expect(await serious(p)).toEqual([]);
  await p.getByRole("button", { name: "Shrani novo verzijo" }).click();
  await expect(p.getByRole("status").filter({ hasText: "Shranjeno kot verzija 2." })).toBeVisible();

  // From an uploaded source: the PDF dropped into "Datoteke branda".
  await p.getByLabel("Izberi datoteke").setInputFiles({ name: "CGP Inženirji.pdf", mimeType: "application/pdf", buffer: fs.readFileSync("tests/fixtures/docs/cgp.pdf") });
  await expect(p.getByTestId("sources")).toContainText("CGP Inženirji.pdf");
  await p.getByLabel("Naložen vir").selectOption({ label: "CGP Inženirji.pdf" });
  await p.getByRole("button", { name: "Uvozi", exact: true }).click();
  await expect(p.getByLabel("CGP — navodila za AI")).toHaveValue(/Pišemo strokovno, toplo in brez žargona\./);
  await p.screenshot({ path: info.outputPath("cgp-import.png"), fullPage: true });
  await ctx.close();
});
