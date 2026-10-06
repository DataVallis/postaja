import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Connecting Claude to Postaja (TASK-010, ADR-038) as Claude drives it: register → authorize → our login → consent →
// code → token → MCP propose_cgp → the owner inserts the proposal and saves a version → disconnect.
const MAIL_DIR = path.resolve("test-results/mail");
const CLAUDE_CB = "https://claude.ai/api/mcp/auth_callback";

function latestLinkTo(email: string): string | undefined {
  if (!fs.existsSync(MAIL_DIR)) return undefined;
  for (const f of fs.readdirSync(MAIL_DIR).sort().reverse()) {
    const m = JSON.parse(fs.readFileSync(path.join(MAIL_DIR, f), "utf8"));
    if (m.to === email && m.subject.includes("Prijava")) return m.text.match(/https?:\/\/\S+/)![0];
  }
}
async function requestLink(page: Page, email: string) {
  const before = latestLinkTo(email);
  await page.getByLabel("E-pošta").fill(email);
  await page.getByRole("button", { name: "Pošlji povezavo" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect.poll(() => latestLinkTo(email), { timeout: 10_000 }).not.toBe(before);
  return latestLinkTo(email)!;
}
async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.goto(await requestLink(page, email));
  await expect(page).toHaveURL(/\/app$/);
}
const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);

async function rpc(request: APIRequestContext, base: string, token: string, method: string, params: Record<string, unknown>) {
  const res = await request.post(`${base}/api/mcp`, {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method, params },
  });
  const text = await res.text();
  return { status: res.status(), body: text.startsWith("{") ? JSON.parse(text) : text ? JSON.parse(text.split("\n").find((l) => l.startsWith("data:"))!.slice(5)) : null };
}

test("owner connects Claude, Claude proposes a CGP, the owner saves it, then disconnects", async ({ page, browser, request, baseURL }, info) => {
  test.skip(info.project.name !== "desktop", "one full flow is enough");
  const stamp = Date.now();
  const owner = `claude-owner-${stamp}@example.test`;
  await signIn(page, "e2e-root@example.test");
  await page.goto("/admin/orgs/new");
  await page.getByLabel("Ime", { exact: true }).fill("Claude E2E");
  await page.getByLabel("Kratko ime (slug)").fill(`claude-${stamp}`);
  await page.getByLabel("E-pošta lastnika").fill(owner);
  await page.getByRole("button", { name: "Ustvari" }).click();
  await expect(page.getByRole("heading", { name: "Claude E2E" })).toBeVisible();

  const ownerCtx = await browser.newContext();
  const p = await ownerCtx.newPage();
  await signIn(p, owner);
  await p.goto("/app/brands/new");
  await p.getByLabel("Ime", { exact: true }).fill("Inženirji");
  await p.getByLabel("Kratko ime (slug)").fill("inzenirji");
  await p.getByRole("button", { name: "Ustvari" }).click();
  await expect(p.getByRole("heading", { name: "Inženirji", level: 1 })).toBeVisible();
  const brandUrl = p.url();

  // The Claude page shows the URL to paste into Claude.
  await p.getByRole("link", { name: "Claude" }).click();
  await expect(p.getByRole("heading", { name: "Claude", level: 1 })).toBeVisible();
  await expect(p.getByLabel("Naslov MCP strežnika")).toHaveValue(`${baseURL}/api/mcp`);
  await expect(p.getByText("Še nobena aplikacija ni povezana.")).toBeVisible();
  expect(await serious(p)).toEqual([]);

  // Claude: discovery + dynamic client registration.
  const prm = await (await request.get(`${baseURL}/.well-known/oauth-protected-resource/api/mcp`)).json();
  expect(prm.resource).toBe(`${baseURL}/api/mcp`);
  const as = await (await request.get(`${baseURL}/.well-known/oauth-authorization-server/api/auth`)).json();
  const reg = await request.post(as.registration_endpoint, { data: { client_name: "Claude", redirect_uris: [CLAUDE_CB], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] } });
  expect(reg.status()).toBe(201);
  const clientId = (await reg.json()).client_id as string;
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = `${as.authorization_endpoint}?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: CLAUDE_CB, scope: "postaja offline_access", state: "st", code_challenge: challenge, code_challenge_method: "S256", resource: `${baseURL}/api/mcp` })}`;

  // The browser part, in a fresh browser (not signed in). claude.ai is stubbed: we only need the code it receives.
  const claudeCtx = await browser.newContext();
  const c = await claudeCtx.newPage();
  await c.route("https://claude.ai/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>claude</title>ok" }));
  await c.goto(authorize);
  await expect(c).toHaveURL(/\/login\?/);
  await expect(c.getByText("Claude se želi povezati s Postajo.")).toBeVisible();
  await c.goto(await requestLink(c, owner));
  await expect(c).toHaveURL(/\/connect\/consent\?/);
  await expect(c.getByRole("heading", { name: "Claude želi dostop do Postaje" })).toBeVisible();
  await expect(c.getByText("Po potrditvi se vrneš v claude.ai.", { exact: false })).toBeVisible();
  expect(await serious(c)).toEqual([]);
  await c.screenshot({ path: info.outputPath("consent.png"), fullPage: true });
  await c.getByRole("button", { name: "Dovoli" }).click();
  await c.waitForURL(/^https:\/\/claude\.ai\/api\/mcp\/auth_callback\?/);
  const back = new URL(c.url());
  expect(back.searchParams.get("state")).toBe("st");
  const code = back.searchParams.get("code")!;
  await claudeCtx.close();

  const tok = await request.post(as.token_endpoint, { form: { grant_type: "authorization_code", code, redirect_uri: CLAUDE_CB, client_id: clientId, code_verifier: verifier, resource: `${baseURL}/api/mcp` } });
  expect(tok.status()).toBe(200);
  const { access_token: accessToken } = await tok.json();

  // Claude uses the tools.
  const noAuth = await request.post(`${baseURL}/api/mcp`, { headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  expect(noAuth.status()).toBe(401);
  expect(noAuth.headers()["www-authenticate"]).toContain(`resource_metadata="${baseURL}/.well-known/oauth-protected-resource/api/mcp"`);
  const proposed = await rpc(request, baseURL!, accessToken, "tools/call", { name: "propose_cgp", arguments: { brand: "inzenirji", cgp: "# Glas\nPišemo kot inženirji, brez žargona.", note: "Iz projekta Inženirji" } });
  expect(proposed.status).toBe(200);
  expect(proposed.body.result.isError ?? false).toBe(false);

  // The owner sees the proposal on the brand page; the active CGP is unchanged until saved.
  await p.goto(brandUrl);
  const banner = p.getByRole("region", { name: "Claude je predlagal CGP" });
  await expect(banner).toContainText("Iz projekta Inženirji");
  await expect(p.getByLabel("CGP — navodila za AI")).toHaveValue("");
  expect(await serious(p)).toEqual([]);
  await banner.getByRole("button", { name: "Vstavi v urejevalnik" }).click();
  await expect(p.getByLabel("CGP — navodila za AI")).toHaveValue("# Glas\nPišemo kot inženirji, brez žargona.");
  await p.getByRole("button", { name: "Shrani novo verzijo" }).click();
  await expect(p.getByRole("status").filter({ hasText: "Shranjeno kot verzija 2." })).toBeVisible();
  await p.reload();
  await expect(p.getByRole("region", { name: "Claude je predlagal CGP" })).toHaveCount(0);
  await expect(p.getByLabel("CGP — navodila za AI")).toHaveValue("# Glas\nPišemo kot inženirji, brez žargona.");

  // Connected app and activity are listed; disconnecting stops the token at once.
  await p.goto("/app/connect");
  await expect(p.getByTestId("connections")).toContainText("claude.ai");
  await expect(p.getByTestId("tool-calls")).toContainText("propose_cgp");
  await p.screenshot({ path: info.outputPath("connect.png"), fullPage: true });
  await p.getByRole("button", { name: "Prekini povezavo" }).click();
  await expect(p.getByText("Še nobena aplikacija ni povezana.")).toBeVisible();
  expect((await rpc(request, baseURL!, accessToken, "tools/list", {})).status).toBe(401);
  await ownerCtx.close();
});
