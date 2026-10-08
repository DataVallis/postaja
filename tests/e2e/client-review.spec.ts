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


// Client approval link (TASK-041): the agency shares a link for a week; the client, without an account, asks for a
// change and then approves; the agency sees it on the post and in the list; a revoked link stops working.
test("client link: the client reviews a week of posts without an account; the agency sees it and revokes the link", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one flow is enough");
  test.setTimeout(150_000);
  const stamp = Date.now();
  const owner = `agencija-${stamp}@example.test`;
  await signIn(page, "e2e-root@example.test");
  await page.goto("/admin/orgs/new");
  await page.getByLabel("Ime", { exact: true }).fill("Agencija E2E");
  await page.getByLabel("Kratko ime (slug)").fill(`agencija-${stamp}`);
  await page.getByLabel("E-pošta lastnika").fill(owner);
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: "Agencija E2E" })).toBeVisible();

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await signIn(p, owner);
  await p.goto("/app/brands/new");
  await p.getByLabel("Ime", { exact: true }).fill("Polygon");
  await p.getByLabel("Kratko ime (slug)").fill("polygon");
  await p.getByRole("button", { name: "Ustvari" }).click();
  await expect(p).toHaveURL(/\/app\/brands\/[0-9a-f-]{36}/);
  const brandUrl = p.url().split(/[?#]/)[0];
  await p.getByRole("navigation", { name: "Razdelki branda" }).getByRole("link", { name: "Kanali" }).click();
  await p.getByLabel("Platforma").selectOption("instagram");
  await p.getByLabel("Profil (@ime)").fill("@polygon");
  await p.getByRole("button", { name: "Dodaj kanal" }).click();
  await expect(p.getByTestId("channels")).toContainText("@polygon");
  await p.goto(brandUrl);
  const monday = await p.getByTestId("approval-form").getByLabel("Od").inputValue();

  // A post for that Monday.
  await p.getByLabel("Kaj objavimo?").fill("Novi pametni pogodbi");
  await p.getByRole("button", { name: "Ustvari objavo" }).click();
  await expect(p).toHaveURL(/\/app\/posts\//);
  const postUrl = p.url();
  await p.getByTestId("slot-form").getByLabel("Dan").fill(monday);
  await p.getByRole("button", { name: "Shrani termin" }).click();
  await expect(p.getByTestId("plan")).toContainText(monday.slice(8, 10).replace(/^0/, ""));

  // The agency makes the link; it is shown once.
  await p.goto(brandUrl);
  const form = p.getByTestId("approval-form");
  await form.getByLabel("Za koga").fill("Polygon – Ana");
  await form.getByRole("button", { name: "Ustvari povezavo" }).click();
  const link = await p.getByTestId("approval-new-link").getByRole("textbox").inputValue();
  expect(link).toMatch(/\/r\/[A-Za-z0-9_-]{40,}$/);
  await expect(p.getByTestId("approval-links")).toContainText("Polygon – Ana");
  expect(await serious(p)).toEqual([]);

  // The client: no account, no menu.
  const client = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const c = await client.newPage();
  await c.goto(link);
  await expect(c.getByRole("heading", { level: 1 })).toHaveText("Objave za Polygon");
  await expect(c.getByRole("navigation", { name: "Glavna navigacija" })).toHaveCount(0);
  const card = c.getByTestId("client-post");
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "Potrebni popravki" }).click();
  await expect(c.getByTestId("client-post").getByRole("alert")).toHaveText("Pri prošnji za popravke napiši komentar.");
  await c.getByTestId("client-post").getByLabel("Komentar").fill("Prosim krajši uvod.");
  await c.getByTestId("client-post").getByLabel("Ime (neobvezno)").fill("Ana");
  await c.getByTestId("client-post").getByRole("button", { name: "Potrebni popravki" }).click();
  await expect(c.getByTestId("client-post").getByRole("status")).toHaveText("Hvala, zabeleženo.");
  await expect(c.getByTestId("client-post-review")).toContainText("Prosim krajši uvod.");
  await c.getByTestId("client-post").getByRole("button", { name: "Odobri" }).click();
  await expect(c.getByTestId("client-post-review")).toContainText("Odobreno");
  expect(await serious(c)).toEqual([]);
  await c.screenshot({ path: info.outputPath("client-review.png"), fullPage: true });

  // The agency sees it on the post (approved now) and in the list.
  await p.goto(postUrl);
  await expect(p.getByTestId("status")).toHaveText("odobrena");
  await expect(p.getByTestId("client-reviews")).toContainText("Stranka je odobrila");
  await expect(p.getByTestId("client-reviews")).toContainText("Prosim krajši uvod.");
  await p.goto(brandUrl);
  await expect(p.getByTestId("client-badge")).toHaveText("stranka: odobreno");
  await expect(p.getByTestId("approval-links")).toContainText("nazadnje odprta");

  // Revoked: the client's page says so.
  await p.getByRole("button", { name: "Prekliči povezavo za Polygon – Ana" }).click();
  await expect(p.getByTestId("approval-links")).toContainText("preklicana");
  await c.goto(link);
  await expect(c.getByRole("heading", { level: 1 })).toHaveText("Povezava ne velja več");
  await client.close();
  await ctx.close();
});
