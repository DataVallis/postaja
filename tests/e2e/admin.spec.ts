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
  await page.goto("/login");
  await page.getByLabel("E-pošta").fill(email);
  await page.getByRole("button", { name: "Pošlji povezavo" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect.poll(() => latestLinkTo(email), { timeout: 10_000 }).toBeTruthy();
  await page.goto(latestLinkTo(email)!);
  await expect(page).toHaveURL(/\/app$/);
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
}

test("super admin creates an organization, sets the plan, invites an editor; invitee joins; non-admins get 404", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one full flow is enough; mobile covers layout via other specs");
  const slug = `e2e-${Date.now()}`;
  const admin = "e2e-root@example.test"; // separate super admin: auth.spec expects e2e-admin to have no org
  const editor = `editor-${Date.now()}@example.test`;

  await signIn(page, admin);
  await page.getByRole("navigation", { name: "Glavna navigacija" }).getByRole("link", { name: "Organizacije" }).click();
  await expect(page.getByRole("heading", { name: "Organizacije" })).toBeVisible();
  expect(await axe(page)).toEqual([]);

  await page.getByRole("link", { name: "Nova organizacija" }).click();
  await page.getByLabel("Ime", { exact: true }).fill("Data Vallis E2E");
  await page.getByLabel("Kratko ime (slug)").fill(slug);
  await page.getByLabel("E-pošta lastnika").fill(admin);
  await page.getByLabel("Plan").selectOption("comped");
  await page.getByLabel("Mesečni limit porabe (USD)").fill("12.5");
  expect(await axe(page)).toEqual([]);
  await page.getByRole("button", { name: "Ustvari" }).click();

  await expect(page.getByRole("heading", { name: "Data Vallis E2E" })).toBeVisible();
  await expect(page.getByLabel("Mesečni limit porabe (USD)")).toHaveValue("12.50");
  await expect(page.getByTestId("members")).toContainText(`${admin} · lastnik`);
  expect(await axe(page)).toEqual([]);

  await page.getByLabel("Mesečni limit porabe (USD)").fill("abc");
  await page.getByRole("button", { name: "Shrani" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Znesek ni veljaven" })).toBeVisible();

  await page.getByLabel("E-pošta", { exact: true }).fill(editor);
  await page.getByLabel("Vloga").selectOption("editor");
  await page.getByRole("button", { name: "Povabi" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Vabilo je poslano." })).toBeVisible();
  await expect(page.getByTestId("members")).toContainText(`${editor} · urednik · povabljen do`);
  await page.screenshot({ path: info.outputPath("admin-org.png"), fullPage: true });

  await page.goto("/admin/audit");
  await expect(page.getByTestId("audit")).toContainText("member.invite");
  await expect(page.getByTestId("audit")).toContainText("org.create");

  await page.goto("/admin/platform");
  await expect(page.getByTestId("platform-rules")).toContainText("instagram");
  await expect(page.getByTestId("presets")).toContainText("1080×1350");
  await expect(page.getByTestId("platform-rules")).toContainText("Hashtags: sources say 30 (older) or 5 (since Jun 2026) -> 5.");
  await expect(page.getByTestId("presets")).toContainText("billo.app Meta safe zones");
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: info.outputPath("admin-platform.png"), fullPage: true });

  await page.goto("/app");
  await expect(page.getByTestId("org")).toContainText("Data Vallis E2E");

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await signIn(p2, editor);
  await expect(p2.getByTestId("org")).toContainText("Data Vallis E2E · urednik");
  const res = await p2.goto("/admin");
  expect(res?.status()).toBe(404);
  await ctx.close();
});

test("anonymous visitors get 404 on /admin", async ({ page }) => {
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);
});

test("super admin edits a platform rule and a preset; invalid values are refused; changes are audited", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "admin editing is a desktop flow; layout is covered by the platform screenshot");
  await signIn(page, "e2e-root@example.test");

  await page.goto("/admin/platform");
  await page.getByRole("link", { name: "Uredi linkedin", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pravila: linkedin" })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  const original = await page.getByLabel("Največ hashtagov").inputValue();
  const next = original === "2" ? "3" : "2"; // always a real change, even on a reused local DB

  // visible-before-more larger than the caption limit is refused, nothing saved
  const caption = await page.getByLabel("Največ znakov").inputValue();
  await page.getByLabel("Vidno pred »več«").fill(String(Number(caption) + 1));
  await page.getByRole("button", { name: "Shrani" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Preveri vrednosti" })).toBeVisible();
  await page.reload();

  await page.getByLabel("Največ hashtagov").fill(next);
  await page.getByRole("button", { name: "Shrani" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Shranjeno in zapisano v dnevnik." })).toBeVisible();
  await page.screenshot({ path: info.outputPath("admin-rule-edit.png"), fullPage: true });

  // saving again without changes writes nothing
  await page.getByRole("button", { name: "Shrani" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Ni sprememb" })).toBeVisible();

  await page.goto("/admin/audit");
  await expect(page.getByTestId("audit")).toContainText("platform_rule.update");
  // jsonb stores keys in its own order ("to" before "from"); LinkedIn has no seeded hashtag limit (empty → null)
  await expect(page.getByTestId("audit")).toContainText(`"hashtagsMax":{"to":"${next}","from":${original === "" ? "null" : `"${original}"`}}`);

  // restore so other specs see the seeded value
  await page.goto("/admin/platform/rules/linkedin");
  await page.getByLabel("Največ hashtagov").fill(original);
  await page.getByRole("button", { name: "Shrani" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Shranjeno" })).toBeVisible();

  // preset: disable and re-enable, safe zone over the whole height is refused
  await page.goto("/admin/platform");
  await page.getByRole("link", { name: "Uredi x_square", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Format: x_square" })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  const height = await page.getByLabel("Višina (px)").inputValue();
  await page.getByLabel("Zgoraj").fill(height);
  await page.getByRole("button", { name: "Shrani" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Preveri vrednosti" })).toBeVisible();
  await page.reload();
  await page.getByLabel(/Format je vklopljen/).uncheck();
  await page.getByRole("button", { name: "Shrani" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Shranjeno" })).toBeVisible();
  await page.goto("/admin/platform");
  await expect(page.getByTestId("presets").getByRole("row").filter({ hasText: "x_square" })).toContainText("izklopljen");
  await page.goto("/admin/platform/presets/x_square");
  await page.getByLabel(/Format je vklopljen/).check();
  await page.getByRole("button", { name: "Shrani" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Shranjeno" })).toBeVisible();
});
