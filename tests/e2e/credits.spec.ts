import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import Stripe from "stripe";
import { expect, test, type Page } from "@playwright/test";

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
/** A webhook as Stripe would send it, signed with the E2E secret; returns the HTTP status. */
async function webhook(page: Page, type: string, object: unknown): Promise<number> {
  const payload = JSON.stringify({ id: `evt_${type}_${Date.now()}_${Math.random()}`, object: "event", type, data: { object } });
  const header = new Stripe("sk_test_x").webhooks.generateTestHeaderString({ payload, secret: "whsec_e2e_not_real" });
  return (await page.request.post("/api/stripe/webhook", { data: payload, headers: { "stripe-signature": header, "content-type": "application/json" } })).status();
}
const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.target}`);


// Credits (TASK-038): the super admin gives an org 0 monthly credits → the owner sees "used up" everywhere, buys a pack
// through Stripe Checkout (stand-in) → the signed webhook adds 500 credits; prices are edited in /admin/credits.
test("credits: allowance from the admin, banner, pack bought through Stripe, price list", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one flow is enough");
  test.setTimeout(120_000);
  const stamp = Date.now();
  const owner = `krediti-${stamp}@example.test`;
  await signIn(page, "e2e-root@example.test");
  await page.goto("/admin/orgs/new");
  await page.getByLabel("Ime", { exact: true }).fill(`Krediti E2E ${stamp}`);
  await page.getByLabel("Kratko ime (slug)").fill(`krediti-${stamp}`);
  await page.getByLabel("E-pošta lastnika").fill(owner);
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: `Krediti E2E ${stamp}` })).toBeVisible();
  await page.getByLabel("Krediti na mesec").fill("0");
  await page.getByRole("button", { name: "Shrani" }).click();
  await expect(page.getByText("Shranjeno").first()).toBeVisible();
  await expect(page.getByTestId("org-credits")).toContainText("na voljo 0");

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await signIn(p, owner);
  await expect(p.getByTestId("credit-banner")).toContainText("Krediti tega meseca so porabljeni.");
  await p.getByTestId("credit-banner").getByRole("link", { name: "Kupi kredite" }).click();
  await expect(p).toHaveURL(/\/app\/team/);
  // Stripe is on in E2E: the pack goes to Checkout; the signed webhook adds the credits.
  await p.getByRole("button", { name: "500 za 25 €" }).click();
  await expect(p).toHaveURL(/\/stripe-page\/checkout-/);
  const log = await (await fetch("http://127.0.0.1:3199/stripe-log")).json() as { path: string; form: Record<string, string> }[];
  const co = log.filter((l) => l.path === "/v1/checkout/sessions" && l.form["metadata[kind]"] === "pack").at(-1)!;
  expect(co.form["line_items[0][price]"]).toBe("price_postaja_credits_500");
  const r = await webhook(p, "checkout.session.completed", { id: `cs_pack_${stamp}`, object: "checkout.session", mode: "payment", payment_status: "paid", customer: null, client_reference_id: co.form.client_reference_id, metadata: { orgId: co.form["metadata[orgId]"], kind: "pack", pack: "small" } });
  expect(r).toBe(200);

  await p.goto("/app/team");
  await expect(p.getByTestId("credit-banner")).toHaveCount(0);
  await expect(p.getByTestId("team-credits")).toContainText("500");
  expect(await serious(p)).toEqual([]);

  await page.goto("/admin/credits");
  // Prices: the super admin raises text to 2 and puts it back.
  await page.getByTestId("credit-prices").getByLabel("Besedilo objave / oglasni copy").fill("2");
  await page.getByRole("button", { name: "Shrani cenik" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cenik je shranjen." })).toBeVisible();
  await expect(page.getByTestId("credit-prices").getByLabel("Besedilo objave / oglasni copy")).toHaveValue("2");
  await page.getByTestId("credit-prices").getByLabel("Besedilo objave / oglasni copy").fill("1");
  await page.getByRole("button", { name: "Shrani cenik" }).click();
  await ctx.close();
});
