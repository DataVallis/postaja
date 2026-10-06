// Full OAuth → MCP flow as Claude drives it (TASK-010, ADR-038): discovery, dynamic client registration, authorize
// with PKCE, our magic-link login continuation, consent, token, refresh, and the MCP tools — plus the refusals.
import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BASE_URL, makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { createBrand } from "../brands/service";
import { createS3Storage, s3ConfigFromEnv } from "../files/storage";
import { createOrganization, inviteMember } from "../orgs/service";
import { createMcpHttpHandler } from "./http";
import { listConnections, revokeConnection } from "./connections";
import { consentDetails, oauthContinuation } from "./oauth-flow";
import { wellKnown } from "./well-known";

const url = process.env.TEST_DATABASE_URL!;
const SECRET = "test-secret-test-secret-test-secret-123";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, auth, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const storage = createS3Storage(s3ConfigFromEnv());
const mcpHandler = createMcpHttpHandler(auth, { db, storage, appUrl: BASE_URL });
const CLAUDE_CB = "https://claude.ai/api/mcp/auth_callback";
const RESOURCE = `${BASE_URL}/api/mcp`;

const call = (path: string, init: RequestInit & { cookie?: string } = {}) => {
  const headers = new Headers(init.headers);
  headers.set("origin", BASE_URL);
  if (init.cookie) headers.set("cookie", init.cookie);
  return auth.handler(new Request(`${BASE_URL}${path}`, { ...init, headers, redirect: "manual" }));
};

let ip = 0;
async function register(redirectUris = [CLAUDE_CB]) {
  const res = await call("/api/auth/oauth2/register", {
    method: "POST",
    // A fresh client IP per registration: the per-IP registration limit is not what these tests are about.
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.${++ip >> 8}.${ip & 255}` },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
  });
  return { status: res.status, body: (await res.json()) as { client_id?: string; error?: string } };
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function authorizeQuery(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: CLAUDE_CB, scope: "postaja offline_access", state: "st-123",
    code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE, ...extra,
  }).toString();
}

/** Walks the browser part: authorize → /login → (magic link) → authorize again → /connect/consent → accept → code. */
async function obtainCode(email: string, clientId: string, challenge: string, extra: Record<string, string> = {}) {
  const first = await call(`/api/auth/oauth2/authorize?${authorizeQuery(clientId, challenge, extra)}`);
  expect(first.status).toBe(302);
  const login = new URL(first.headers.get("location")!, BASE_URL);
  expect(login.pathname, login.search).toBe("/login");
  const cont = await oauthContinuation(login.search, SECRET);
  expect(cont).toMatch(/^\/api\/auth\/oauth2\/authorize\?/);
  const cookie = (await signIn(email))!;
  const again = await call(cont!, { cookie });
  expect(again.status).toBe(302);
  const consent = new URL(again.headers.get("location")!, BASE_URL);
  expect(consent.pathname).toBe("/connect/consent");
  const details = await consentDetails(db, consent.search.slice(1), SECRET);
  expect(details).toMatchObject({ clientName: "Claude", redirectHost: "claude.ai" });
  const accepted = await call("/api/auth/oauth2/consent", {
    method: "POST", cookie, headers: { "content-type": "application/json" },
    body: JSON.stringify({ accept: true, oauth_query: consent.search.slice(1) }),
  });
  expect(accepted.status).toBe(200);
  const { url: redirect } = (await accepted.json()) as { url: string };
  const back = new URL(redirect);
  expect(`${back.origin}${back.pathname}`).toBe(CLAUDE_CB);
  expect(back.searchParams.get("state")).toBe("st-123");
  return { code: back.searchParams.get("code")!, cookie };
}

async function token(form: Record<string, string>) {
  const res = await call("/api/auth/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
  return { status: res.status, body: (await res.json()) as { access_token?: string; refresh_token?: string; token_type?: string; expires_in?: number; error?: string } };
}

async function connect(email: string) {
  const { body: client } = await register();
  const { verifier, challenge } = pkce();
  const { code } = await obtainCode(email, client.client_id!, challenge);
  const t = await token({ grant_type: "authorization_code", code, redirect_uri: CLAUDE_CB, client_id: client.client_id!, code_verifier: verifier, resource: RESOURCE });
  expect(t.status).toBe(200);
  return { clientId: client.client_id!, ...t.body };
}

let rpcId = 0;
async function mcp(accessToken: string | null, method: string, params: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  const res = await mcpHandler(new Request(RESOURCE, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) }));
  const text = await res.text();
  const json = text.startsWith("{") ? JSON.parse(text) : JSON.parse(text.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
  return { status: res.status, headers: res.headers, json };
}
const tool = async (t: string, name: string, args: Record<string, unknown> = {}) => {
  const r = await mcp(t, "tools/call", { name, arguments: args });
  const result = r.json.result as { isError?: boolean; content: { text: string }[]; structuredContent?: unknown };
  return { isError: !!result.isError, text: result.content[0].text, data: result.structuredContent as Record<string, unknown> };
};

let brandA: string;
beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, channels, brand_sources, brand_assets, oauth_client, oauth_access_token, oauth_refresh_token, oauth_consent, cgp_drafts, mcp_tool_calls cascade`;
  const s = (await session((await signIn("boss@datavallis.com"))!))!;
  const actor = { userId: s.user.id, role: "superadmin" as const };
  const d = { mailer, baseURL: BASE_URL };
  const a = await createOrganization(db, d, actor, { name: "Org A", slug: "org-a", plan: "pro", ownerEmail: "boss@datavallis.com" });
  const b = await createOrganization(db, d, actor, { name: "Org B", slug: "org-b", plan: "pro", ownerEmail: "b@b.si" });
  await signIn("b@b.si");
  await inviteMember(db, d, actor, a.orgId, { email: "ed@a.si", role: "editor" });
  await signIn("ed@a.si");
  const A = { userId: s.user.id, orgId: a.orgId, orgName: "Org A", role: "owner" as const, plan: "pro" as const };
  const bUser = (await sql`select id from "user" where email = 'b@b.si'`)[0].id as string;
  brandA = (await createBrand(db, A, { name: "Inženirji", slug: "inzenirji", languages: ["sl"] })).id;
  await createBrand(db, { userId: bUser, orgId: b.orgId, orgName: "Org B", role: "owner", plan: "pro" }, { name: "Cherr", slug: "cherr", languages: ["en"] });
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

describe("discovery", () => {
  it("protected resource metadata names the exact MCP URL and our authorization server", async () => {
    const res = await call("/.well-known/oauth-protected-resource/api/mcp");
    expect(res.status).toBe(200);
    const m = (await res.json()) as { resource: string; authorization_servers: string[]; scopes_supported: string[] };
    expect(m.resource).toBe(RESOURCE);
    expect(m.authorization_servers[0]).toBe(`${BASE_URL}/api/auth`);
    expect(m.scopes_supported).toContain("postaja");
  });

  it("authorization server metadata: DCR, PKCE S256, public clients", async () => {
    const res = await call("/.well-known/oauth-authorization-server/api/auth");
    expect(res.status).toBe(200);
    const m = (await res.json()) as Record<string, unknown>;
    expect(m.issuer).toBe(`${BASE_URL}/api/auth`);
    expect(m.registration_endpoint).toBe(`${BASE_URL}/api/auth/oauth2/register`);
    expect(m.code_challenge_methods_supported).toEqual(["S256"]);
    expect(m.token_endpoint_auth_methods_supported).toContain("none");
  });

  it("every discovery URL a client may try is answered by the auth handler (what the Next.js .well-known routes call)", async () => {
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/api/mcp",
      "/.well-known/oauth-authorization-server/api/auth",
      "/.well-known/openid-configuration/api/auth",
      "/api/auth/.well-known/openid-configuration",
    ]) {
      const res = await wellKnown(auth, new Request(`${BASE_URL}${path}`));
      expect(res.status, path).toBe(200);
      expect(((await res.json()) as { resource?: string; issuer?: string }).resource ?? "issuer").toBeTruthy();
    }
  });

  it("MCP without a token → 401 with a resource_metadata challenge", async () => {
    const r = await mcp(null, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource/api/mcp", scope="postaja"`);
  });

  it("a garbage token → 401 invalid_token", async () => {
    const r = await mcp("abc.def.ghi", "tools/list");
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });
});

describe("connecting Claude", () => {
  it("register → login → consent → token → MCP tools → refresh", async () => {
    const t = await connect("boss@datavallis.com");
    expect(t.token_type?.toLowerCase()).toBe("bearer");
    expect(t.access_token!.split(".")).toHaveLength(3);
    expect(t.refresh_token).toBeTruthy();

    const init = await mcp(t.access_token!, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude", version: "1" } });
    expect(init.status).toBe(200);
    expect(init.json.result.serverInfo.name).toBe("postaja");
    expect(init.json.result.instructions).toMatch(/knowledge base.*Do not write posts here/s); // ADR-039

    const list = await mcp(t.access_token!, "tools/list");
    expect((list.json.result.tools as { name: string }[]).map((x) => x.name).sort()).toEqual(["add_material", "get_brand", "list_brands", "propose_cgp"]);

    const brands = await tool(t.access_token!, "list_brands");
    expect(brands.isError).toBe(false);
    expect(JSON.stringify(brands.data)).toContain("inzenirji");
    expect(JSON.stringify(brands.data)).not.toContain("cherr"); // org B's brand

    const log = await sql`select tool, ok, client_id from mcp_tool_calls order by created_at`;
    expect(log.map((r) => r.tool)).toEqual(["list_brands"]);
    expect(log[0].client_id).toBe(t.clientId);

    const r = await token({ grant_type: "refresh_token", refresh_token: t.refresh_token!, client_id: t.clientId, resource: RESOURCE });
    expect(r.status).toBe(200);
    expect(r.body.access_token).toBeTruthy();
    expect(r.body.refresh_token).not.toBe(t.refresh_token); // rotated
    expect((await tool(r.body.access_token!, "list_brands")).isError).toBe(false);
  });

  it("propose_cgp stores a pending draft only; the active CGP is unchanged", async () => {
    const t = await connect("boss@datavallis.com");
    const before = await sql`select count(*)::int n from brand_profile_versions`;
    const r = await tool(t.access_token!, "propose_cgp", { brand: "inzenirji", cgp: "# Glas\nPišemo kot inženirji.", note: "Iz pogovora" });
    expect(r.isError).toBe(false);
    expect(r.data.reviewUrl).toBe(`${BASE_URL}/app/brands/${brandA}#profile-h`);
    expect(await sql`select count(*)::int n from brand_profile_versions`).toEqual(before);
    expect(await sql`select brand_id, text, status, source from cgp_drafts`).toEqual([{ brand_id: brandA, text: "# Glas\nPišemo kot inženirji.", status: "pending", source: "claude" }]);
  });

  it("org B's token sees only org B and cannot reach org A's brand by slug or id", async () => {
    const t = await connect("b@b.si");
    const brands = await tool(t.access_token!, "list_brands");
    expect(JSON.stringify(brands.data)).toContain("cherr");
    expect(JSON.stringify(brands.data)).not.toContain("inzenirji");
    for (const ref of ["inzenirji", brandA]) {
      const g = await tool(t.access_token!, "get_brand", { brand: ref });
      expect(g.isError).toBe(true);
      const p = await tool(t.access_token!, "propose_cgp", { brand: ref, cgp: "x" });
      expect(p.isError).toBe(true);
    }
    expect((await sql`select count(*)::int n from cgp_drafts`)[0].n).toBe(0);
  });

  it("an editor can read but not propose a CGP or add materials", async () => {
    const t = await connect("ed@a.si");
    expect((await tool(t.access_token!, "get_brand", { brand: "inzenirji" })).isError).toBe(false);
    const p = await tool(t.access_token!, "propose_cgp", { brand: "inzenirji", cgp: "x" });
    expect(p).toMatchObject({ isError: true });
    expect(p.text).toMatch(/owner/i);
    expect((await tool(t.access_token!, "add_material", { brand: "inzenirji", filename: "cenik", text: "x" })).isError).toBe(true);
    expect((await sql`select count(*)::int n from brand_sources`)[0].n).toBe(0);
  });
});

describe("connections", () => {
  it("signing out of the web app keeps Claude connected (offline refresh survives the session)", async () => {
    const t = await connect("boss@datavallis.com");
    await sql`delete from session`;
    const r = await token({ grant_type: "refresh_token", refresh_token: t.refresh_token!, client_id: t.clientId, resource: RESOURCE });
    expect(r.status).toBe(200);
    expect((await tool(r.body.access_token!, "list_brands")).isError).toBe(false);
  });

  it("disconnecting stops the access token at once and the refresh token for good; only the person's own", async () => {
    const t = await connect("boss@datavallis.com");
    const other = await connect("b@b.si");
    const boss = (await sql`select id from "user" where email = 'boss@datavallis.com'`)[0].id as string;
    const bUser = (await sql`select id from "user" where email = 'b@b.si'`)[0].id as string;
    expect((await listConnections(db, boss)).map((c) => c.name)).toEqual(["Claude"]);
    // b cannot remove boss's connection by naming boss's client
    expect(await revokeConnection(db, bUser, t.clientId)).toBe(false);
    expect((await tool(t.access_token!, "list_brands")).isError).toBe(false);

    expect(await revokeConnection(db, boss, t.clientId)).toBe(true);
    expect(await listConnections(db, boss)).toEqual([]);
    const r = await mcp(t.access_token!, "tools/list");
    expect(r.status).toBe(401);
    const refreshed = await token({ grant_type: "refresh_token", refresh_token: t.refresh_token!, client_id: t.clientId, resource: RESOURCE });
    expect(refreshed.body.access_token).toBeUndefined();
    expect((await tool(other.access_token!, "list_brands")).isError).toBe(false);
  });
});

describe("refusals", () => {
  it("a client registered with a foreign redirect never gets a code", async () => {
    // Anyone may register (DCR), but authorize only ever sends codes to Claude's callbacks (isAllowedMcpRedirect).
    const reg = await register(["https://evil.example/cb"]);
    expect(reg.status).toBe(201);
    const { challenge } = pkce();
    const q = new URLSearchParams({ response_type: "code", client_id: reg.body.client_id!, redirect_uri: "https://evil.example/cb", scope: "postaja", state: "s", code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE });
    const cookie = (await signIn("boss@datavallis.com"))!;
    for (const c of [undefined, cookie]) {
      const res = await call(`/api/auth/oauth2/authorize?${q}`, { cookie: c });
      const loc = res.headers.get("location") ?? "";
      expect(loc, `status ${res.status}`).not.toContain("evil.example");
      expect(loc.startsWith(`${BASE_URL}/api/auth/error`) || res.status >= 400, loc).toBe(true);
    }
  });

  it("a Claude client cannot switch to a foreign redirect at authorize time", async () => {
    const { body } = await register();
    const { challenge } = pkce();
    const cookie = (await signIn("boss@datavallis.com"))!;
    const q = authorizeQuery(body.client_id!, challenge, { redirect_uri: "https://evil.example/cb" });
    const res = await call(`/api/auth/oauth2/authorize?${q}`, { cookie });
    const loc = res.headers.get("location") ?? "";
    expect(loc).not.toContain("evil.example");
    expect(loc.startsWith(`${BASE_URL}/api/auth/error`) || res.status >= 400, loc).toBe(true);
  });

  it("tokens are bound to this MCP URL: without a resource parameter the client's default resource is used; another audience is refused", async () => {
    const { body } = await register();
    const { verifier, challenge } = pkce();
    const { code } = await obtainCode("boss@datavallis.com", body.client_id!, challenge);
    const t = await token({ grant_type: "authorization_code", code, redirect_uri: CLAUDE_CB, client_id: body.client_id!, code_verifier: verifier });
    const claims = JSON.parse(Buffer.from(t.body.access_token!.split(".")[1], "base64url").toString()) as { aud: string | string[] };
    expect([claims.aud].flat()).toContain(RESOURCE);
    // The same token presented to an MCP server at another URL (other audience) is refused.
    const other = createMcpHttpHandler(auth, { db, storage, appUrl: "http://127.0.0.1:4000" });
    const res = await other(new Request("http://127.0.0.1:4000/api/mcp", { method: "POST", headers: { authorization: `Bearer ${t.body.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }));
    expect(res.status).toBe(401);
  });

  it("a token without the postaja scope → 403 insufficient_scope", async () => {
    const { body } = await register();
    const { verifier, challenge } = pkce();
    const { code } = await obtainCode("boss@datavallis.com", body.client_id!, challenge, { scope: "openid offline_access" });
    const t = await token({ grant_type: "authorization_code", code, redirect_uri: CLAUDE_CB, client_id: body.client_id!, code_verifier: verifier, resource: RESOURCE });
    expect(t.status).toBe(200);
    const r = await mcp(t.body.access_token!, "tools/list");
    expect(r.status).toBe(403);
    expect(r.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
  });

  it("the code needs the PKCE verifier", async () => {
    const { body } = await register();
    const { challenge } = pkce();
    const { code } = await obtainCode("boss@datavallis.com", body.client_id!, challenge);
    const t = await token({ grant_type: "authorization_code", code, redirect_uri: CLAUDE_CB, client_id: body.client_id!, code_verifier: pkce().verifier, resource: RESOURCE });
    expect([400, 401]).toContain(t.status);
    expect(t.body.error).toMatch(/invalid_grant|invalid_request/);
    expect(t.body.access_token).toBeUndefined();
  });

  it("a tampered login query is not continued", async () => {
    const { body } = await register();
    const first = await call(`/api/auth/oauth2/authorize?${authorizeQuery(body.client_id!, pkce().challenge)}`);
    const q = new URL(first.headers.get("location")!, BASE_URL).searchParams;
    q.set("redirect_uri", "https://evil.example/cb");
    expect(await oauthContinuation(q.toString(), SECRET)).toBeNull();
    expect(await consentDetails(db, q.toString(), SECRET)).toBeNull();
    expect(await oauthContinuation("client_id=x&redirect_uri=https://evil.example/cb", SECRET)).toBeNull();
  });

  it("a user without an organization gets 403 from MCP", async () => {
    await sql`delete from member where user_id = (select id from "user" where email = 'b@b.si')`;
    const t = await connect("b@b.si");
    const r = await mcp(t.access_token!, "tools/list");
    expect(r.status).toBe(403);
  });
});
