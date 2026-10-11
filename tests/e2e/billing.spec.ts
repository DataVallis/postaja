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
// plan active with its limits; Studio offers the persona as an upgrade, add-ons raise the limits and unlock it
// (TASK-053); the portal opens; when Stripe reports the subscription cancelled, creating stops and the
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
  await billing.getByRole("button", { name: "Studio mesečno, 149 €" }).click();
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

  // Studio has no persona (TASK-053): the brand's Persona tab offers the upgrade instead of the tool.
  await p.goto("/app/brands/new");
  await p.getByLabel("Ime", { exact: true }).fill("Plačila brand");
  await p.getByRole("button", { name: "Ustvari" }).click();
  await p.getByRole("link", { name: "Preskoči na brand" }).click();
  await expect(p).toHaveURL(/\/app\/brands\/[\w-]+$/);
  const brandUrl = p.url().replace(/[?#].*$/, "");
  await p.goto(`${brandUrl}?tab=persona`);
  await expect(p.getByTestId("upgrade-persona")).toContainText("Na voljo v paketu Agencija ali kot dodatek za 49 € / mesec.");
  await expect(p.getByTestId("persona-manual")).toHaveCount(0);
  await p.goto(`${brandUrl}?tab=ads`);
  await expect(p.getByTestId("upgrade-ads")).toHaveCount(0);

  // Add-ons on the live subscription: two extra brands and the persona; Stripe's webhook then raises the limits.
  await p.goto("/app/team");
  const addons = p.getByTestId("billing-addons");
  await addons.getByLabel(/Dodatni brandi/).fill("2");
  await addons.getByLabel(/Persona/).check();
  expect(await serious(p)).toEqual([]);
  await addons.getByRole("button", { name: "Shrani dodatke" }).click();
  await expect(p.getByRole("status").filter({ hasText: "Dodatki so shranjeni." })).toBeVisible();
  const upd = ((await (await fetch("http://127.0.0.1:3199/stripe-log")).json()) as { path: string; form: Record<string, string> }[]).filter((l) => l.path === `/v1/subscriptions/sub_${stamp}`).at(-1)!;
  expect(upd.form).toMatchObject({ "items[0][price]": "price_postaja_addon_brand_month", "items[0][quantity]": "2", "items[1][price]": "price_postaja_addon_persona_month", proration_behavior: "create_prorations" });
  const withAddons = { ...sub("active"), items: { data: [
    ...sub("active").items.data, { price: { lookup_key: "postaja_addon_brand_month" }, quantity: 2 }, { price: { lookup_key: "postaja_addon_persona_month" }, quantity: 1 },
  ] } };
  expect(await webhook(p, "customer.subscription.updated", withAddons)).toBe(200);
  await p.reload();
  await expect(p.getByTestId("team-usage")).toContainText("1 / 8");
  await expect(addons.getByLabel(/Dodatni brandi/)).toHaveValue("2");
  await p.goto(`${brandUrl}?tab=persona`);
  await expect(p.getByTestId("persona-manual")).toBeVisible();

  await p.goto("/app/team");
  await p.getByRole("button", { name: /Upravljaj naročnino/ }).click();
  await expect(p).toHaveURL(/\/stripe-page\/portal-/);

  // The paid invoice is listed for the owner's own invoice; he records its number.
  expect(await webhook(p, "invoice.paid", {
    id: `in_${stamp}`, object: "invoice", customer, subscription: `sub_${stamp}`, total: 18178, subtotal: 14900, total_excluding_tax: 14900, currency: "eur",
    customer_name: `Plačnik ${stamp} d.o.o.`, customer_email: owner, customer_address: { line1: "Glavna 1", postal_code: "2000", city: "Maribor", country: "SI" },
    customer_tax_ids: [], status_transitions: { paid_at: Math.floor(Date.now() / 1000) }, lines: { data: [{ price: { lookup_key: "postaja_studio_month" }, period: { start: Math.floor(Date.now() / 1000), end: Math.floor(Date.now() / 1000) + 30 * 86400 } }] },
  })).toBe(200);
  await page.goto("/admin/billing");
  const pay = page.getByTestId("billing-payment").filter({ hasText: `Plačnik ${stamp} d.o.o.` });
  await expect(pay).toContainText("neto 149,00 € · DDV 32,78 € · skupaj 181,78 €");
  await pay.getByLabel(`Številka računa za Plačnik ${stamp} d.o.o.`).fill(`R-${stamp}`);
  await pay.getByRole("button", { name: "Shrani" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Številka računa je shranjena." })).toBeVisible();
  await expect(page.getByTestId("billing-payment").filter({ hasText: `Plačnik ${stamp} d.o.o.` })).toHaveCount(0); // invoiced → not in the open list
  const csv = await (await page.request.get("/admin/billing/payments.csv")).text();
  expect(csv).toContain(`Plačnik ${stamp} d.o.o.;Glavna 1, 2000 Maribor, SI;SI;;ne;${owner};149,00;32,78;181,78;EUR;R-${stamp}`);
  await expect(page.getByTestId("billing-subs")).toContainText(`Plačila E2E ${stamp} · studio · active`);
  await expect(page.getByTestId("billing-events")).toContainText("subscription:active:studio");
  expect(await serious(page)).toEqual([]);

  expect(await webhook(p, "customer.subscription.deleted", sub("canceled"))).toBe(200);
  await p.goto("/app");
  await expect(p.getByTestId("billing-banner")).toContainText("Naročnina je končana");
  await ctx.close();
});
