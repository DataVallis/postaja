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


// Payments (TASK-036): an owner buys Studio monthly through Stripe Checkout (stand-in); the signed webhooks make the
// plan active with its limits; the portal opens; when Stripe reports the subscription cancelled, creating stops and the
// app says so; a forged webhook is refused.
test("payments: Studio through Checkout → webhook → plan and limits; portal; cancelled → banner; bad signature refused", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one flow is enough");
  test.setTimeout(120_000);
  const stamp = Date.now();
  const owner = `placnik-${stamp}@example.test`;
  await signIn(page, "e2e-root@example.test");
  await page.goto("/admin/orgs/new");
  await page.getByLabel("Ime", { exact: true }).fill(`Plačila E2E ${stamp}`);
  await page.getByLabel("Kratko ime (slug)").fill(`placila-${stamp}`);
  await page.getByLabel("E-pošta lastnika").fill(owner);
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: `Plačila E2E ${stamp}` })).toBeVisible();

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await signIn(p, owner);
  await p.goto("/app/team");
  const billing = p.getByTestId("team-billing");
  await expect(billing.getByTestId("plan-studio")).toContainText("6 brandov · 3 članov · 1500 kreditov na mesec");
  expect(await serious(p)).toEqual([]);
  await billing.getByRole("button", { name: "Studio mesečno, 99 €" }).click();
  await expect(p).toHaveURL(/\/stripe-page\/checkout-/);
  const log = await (await fetch("http://127.0.0.1:3199/stripe-log")).json() as { path: string; form: Record<string, string> }[];
  const co = log.filter((l) => l.path === "/v1/checkout/sessions" && l.form["metadata[plan]"] === "studio").at(-1)!;
  expect(co.form).toMatchObject({ mode: "subscription", "line_items[0][price]": "price_postaja_studio_month", "tax_id_collection[enabled]": "true" });
  const orgId = co.form["metadata[orgId]"];
  const customer = co.form.customer;

  // A forged event is refused; the real ones are processed (twice is the same as once).
  expect((await p.request.post("/api/stripe/webhook", { data: "{}", headers: { "stripe-signature": "t=1,v1=bad" } })).status()).toBe(400);
  const sub = (status: string) => ({
    id: `sub_${stamp}`, object: "subscription", customer, status, cancel_at_period_end: false, metadata: { orgId },
    items: { data: [{ price: { lookup_key: "postaja_studio_month" }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] },
  });
  expect(await webhook(p, "checkout.session.completed", { id: `cs_${stamp}`, object: "checkout.session", mode: "subscription", payment_status: "paid", customer, client_reference_id: orgId, metadata: { orgId, kind: "plan", plan: "studio" } })).toBe(200);
  expect(await webhook(p, "customer.subscription.created", sub("active"))).toBe(200);

  await p.goto("/app/team?billing=success");
  await expect(p.getByRole("status").filter({ hasText: "Hvala! Plačilo je prejeto" })).toBeVisible();
  await expect(p.getByTestId("billing-state")).toContainText("Naročnina je aktivna (mesečno)");
  await expect(p.getByRole("heading", { name: "Paket: Studio" })).toBeVisible();
  await expect(p.getByTestId("team-usage")).toContainText("0 / 6");
  await p.getByRole("button", { name: /Upravljaj naročnino/ }).click();
  await expect(p).toHaveURL(/\/stripe-page\/portal-/);

  // The paid invoice is listed for the owner's own invoice; he records its number.
  expect(await webhook(p, "invoice.paid", {
    id: `in_${stamp}`, object: "invoice", customer, subscription: `sub_${stamp}`, total: 12078, subtotal: 9900, total_excluding_tax: 9900, currency: "eur",
    customer_name: `Plačnik ${stamp} d.o.o.`, customer_email: owner, customer_address: { line1: "Glavna 1", postal_code: "2000", city: "Maribor", country: "SI" },
    customer_tax_ids: [], status_transitions: { paid_at: Math.floor(Date.now() / 1000) }, lines: { data: [{ price: { lookup_key: "postaja_studio_month" }, period: { start: Math.floor(Date.now() / 1000), end: Math.floor(Date.now() / 1000) + 30 * 86400 } }] },
  })).toBe(200);
  await page.goto("/admin/billing");
  const pay = page.getByTestId("billing-payment").filter({ hasText: `Plačnik ${stamp} d.o.o.` });
  await expect(pay).toContainText("neto 99,00 € · DDV 21,78 € · skupaj 120,78 €");
  await pay.getByLabel(`Številka računa za Plačnik ${stamp} d.o.o.`).fill(`R-${stamp}`);
  await pay.getByRole("button", { name: "Shrani" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Številka računa je shranjena." })).toBeVisible();
  await expect(page.getByTestId("billing-payment").filter({ hasText: `Plačnik ${stamp} d.o.o.` })).toHaveCount(0); // invoiced → not in the open list
  const csv = await (await page.request.get("/admin/billing/payments.csv")).text();
  expect(csv).toContain(`Plačnik ${stamp} d.o.o.;Glavna 1, 2000 Maribor, SI;SI;;ne;${owner};99,00;21,78;120,78;EUR;R-${stamp}`);
  await expect(page.getByTestId("billing-subs")).toContainText(`Plačila E2E ${stamp} · studio · active`);
  await expect(page.getByTestId("billing-events")).toContainText("subscription:active:studio");
  expect(await serious(page)).toEqual([]);

  expect(await webhook(p, "customer.subscription.deleted", sub("canceled"))).toBe(200);
  await p.goto("/app");
  await expect(p.getByTestId("billing-banner")).toContainText("Naročnina je končana");
  await ctx.close();
});
