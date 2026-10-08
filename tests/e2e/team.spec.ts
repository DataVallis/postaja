import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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

// Team and plan (TASK-028): the owner invites an editor, the editor joins on sign-in, roles change, the plan's member
// limit set by the super admin stops a further invitation; usage is shown.
test("team: invite, join, change role, remove; member limit from the admin", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one flow is enough");
  test.setTimeout(120_000);
  const stamp = Date.now();
  const owner = `ekipa-${stamp}@example.test`;
  const editor = `urednik-${stamp}@example.test`;
  await signIn(page, "e2e-root@example.test");
  await page.goto("/admin/orgs/new");
  await page.getByLabel("Ime", { exact: true }).fill("Ekipa E2E");
  await page.getByLabel("Kratko ime (slug)").fill(`ekipa-${stamp}`);
  await page.getByLabel("E-pošta lastnika").fill(owner);
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: "Ekipa E2E" })).toBeVisible();
  const adminUrl = page.url();

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await signIn(p, owner);
  await p.getByRole("navigation", { name: "Glavna navigacija" }).getByRole("link", { name: "Ekipa in paket" }).click();
  await expect(p.getByRole("heading", { name: "Ekipa in paket", level: 1 })).toBeVisible();
  await expect(p.getByTestId("team-usage")).toContainText("(brez omejitve)");
  const invite = p.getByTestId("team-invite");
  await invite.getByLabel("E-pošta").fill(editor);
  await invite.getByRole("button", { name: "Povabi" }).click();
  await expect(p.getByRole("status").filter({ hasText: /./ }).first()).toHaveText("Vabilo je poslano.");
  await expect(p.getByTestId("team-invites")).toContainText(editor);
  expect(await serious(p)).toEqual([]);

  // The super admin limits the plan to 2 members (the owner + the pending invitation).
  await page.goto(adminUrl);
  await page.getByLabel("Največ članov (z vabili)").fill("2");
  await page.getByRole("button", { name: "Shrani" }).click();
  await expect(page.getByText("Shranjeno").first()).toBeVisible();
  await p.goto("/app/team");
  await p.getByTestId("team-invite").getByLabel("E-pošta").fill(`tretji-${stamp}@example.test`);
  await p.getByTestId("team-invite").getByRole("button", { name: "Povabi" }).click();
  await expect(p.getByText("Paket ne dovoli več članov.", { exact: false })).toBeVisible();
  await expect(p.getByTestId("team-usage")).toContainText("2 / 2");

  // The editor signs in and is a member.
  const ectx = await browser.newContext();
  const e = await ectx.newPage();
  await signIn(e, editor);
  await e.goto("/app/team");
  await expect(e.getByTestId("team-members")).toContainText(editor);
  await expect(e.getByTestId("team-invite")).toHaveCount(0);
  await ectx.close();

  await p.goto("/app/team");
  const row = p.getByTestId("team-members").getByRole("row").filter({ hasText: editor });
  await row.getByLabel(`Vloga za ${editor}`).selectOption("owner");
  await row.getByRole("button", { name: "Spremeni" }).click();
  await expect(p.getByRole("status").filter({ hasText: /./ }).first()).toHaveText("Vloga je spremenjena.");
  await expect(p.getByTestId("team-members").getByRole("row").filter({ hasText: editor }).getByLabel(`Vloga za ${editor}`)).toHaveValue("owner");
  const row2 = p.getByTestId("team-members").getByRole("row").filter({ hasText: editor });
  await row2.getByText("Odstrani", { exact: true }).click();
  await row2.getByRole("button", { name: `Odstrani ${editor}` }).click();
  await expect(p.getByRole("status").filter({ hasText: /./ }).first()).toHaveText("Član je odstranjen.");
  await expect(p.getByTestId("team-members")).not.toContainText(editor);
  await p.screenshot({ path: info.outputPath("team.png"), fullPage: true });
  await ctx.close();
});
