# Claude → Postaja (MCP server)

Status: **Built** (TASK-010a). Decision: ADR-038.

The owner keeps projects, history and CGPs in Claude. Claude has no API that lets Postaja read them, so it works the
other way round: **Postaja is a remote MCP server**, the owner adds it to Claude as a custom connector, and Claude
**pushes** what the owner asks for (a CGP, a price list, notes) into a brand.

## Endpoints
| URL | What |
|---|---|
| `POST/GET/DELETE /api/mcp` | MCP Streamable HTTP (stateless). Bearer token required. `src/app/api/mcp/route.ts` → `src/server/mcp/http.ts` |
| `/.well-known/oauth-protected-resource/api/mcp` (+ root form) | RFC 9728 metadata: `resource` = the exact MCP URL, `authorization_servers` = `<app>/api/auth` |
| `/.well-known/oauth-authorization-server/api/auth`, `/.well-known/openid-configuration/api/auth`, `/api/auth/.well-known/openid-configuration` | AS / OIDC metadata |
| `/api/auth/oauth2/register` · `/authorize` · `/token` · `/consent` · `/jwks` | Better Auth OAuth 2.1 provider (`@better-auth/mcp`) |
| `/login?<signed query>` | Our magic-link login, continuing the authorize request after sign-in |
| `/connect/consent?<signed query>` | "Claude želi dostop do Postaje" — Dovoli / Zavrni |
| `/app/connect` | URL to paste into Claude, connected apps (disconnect), last 20 tool calls |

`/.well-known/*` is a rewrite (`next.config.ts`) to `src/app/api/well-known/[...path]` because the app router does not
build dot-folders; the handler maps back to the original path and calls Better Auth (`src/server/mcp/well-known.ts`).

## OAuth (what Claude does)
1. `POST /api/mcp` without a token → **401** `WWW-Authenticate: Bearer resource_metadata="<app>/.well-known/oauth-protected-resource/api/mcp", scope="postaja"`.
2. Reads PRM + AS metadata, **registers dynamically** (DCR, public client, `token_endpoint_auth_method=none`).
3. Browser → `/api/auth/oauth2/authorize` (PKCE S256, `resource=<app>/api/mcp`) → `/login?…&sig=…`.
   The login page verifies the signature (`oauthContinuation`) and passes the original authorize URL as the magic link's
   `callbackURL`; after sign-in the browser lands back on authorize → `/connect/consent` → Dovoli →
   `https://claude.ai/api/mcp/auth_callback?code=…&state=…`.
4. Token endpoint → JWT access token (1 h, `aud` = MCP URL, scope `postaja`) + rotating refresh token (30 days, `offline_access`).

**Redirects:** anyone may register, but codes go only to `https://claude.ai/api/mcp/auth_callback` or Claude Code's
loopback `http://localhost|127.0.0.1:<any port>/callback` (`isAllowedMcpRedirect` + `validateRedirectUri` in `auth.ts`).
A client registered with another redirect gets an error page, never a code.

**Rate limits** (per IP; all Claude users share Anthropic's egress IPs): register 20/min, token 60/min, authorize 30/min.

## Access-token check (`verifyMcpToken`)
JWT verified **in-process** against the local JWKS (`auth.api.getJwks()`; no HTTP call to ourselves): signature, issuer
`<app>/api/auth`, audience = this MCP URL, expiry; DPoP-bound tokens refused; scope must include `postaja` (else **403**
`insufficient_scope`). Then the **consent row (user × client) must still exist** — disconnecting on `/app/connect`
stops an unexpired token immediately. The organization is the user's first membership, re-verified like every app
request (`mcpContext` → `resolveOrgContext`); no organization → 403.

Signing out of the web app does **not** disconnect Claude: `oauth_*_token.session_id` is `ON DELETE SET NULL`
(migration 0012) and `offline_access` refresh tokens survive the session.

## Tools (`src/server/mcp/server.ts`, `service.ts`)
| Tool | Who | Does |
|---|---|---|
| `list_brands` | member | brands of the org with channels |
| `get_brand` | member | CGP (active version), rules, pillars, channels, material names, logo count, fonts — by slug or id |
| `propose_cgp` | owner | stores the text as a **pending draft** (`cgp_drafts`, ≤ 50,000 chars; earlier pending drafts of the brand discarded). The active CGP never changes here (ADR-035). Returns the review URL. |
| `add_material` | owner | text from the conversation → a brand source (`.md` unless named `.txt`/`.csv`), through the normal upload checks |

Every call is logged in `mcp_tool_calls` (org, user, client, tool, ok/error code) — **arguments are not stored**.
Errors return MCP tool errors with a readable reason (not found, owner only, archived, too long).

## CGP proposals in the app
The brand page shows "Claude je predlagal CGP" above the CGP editor (owner only): **Vstavi v urejevalnik** puts the
text into the field; **Shrani novo verzijo** saves it as a version and marks the draft `used`; **Zavrzi predlog**
marks it `discarded`.

## Tables
`jwks`, `oauth_client`, `oauth_resource`, `oauth_client_resource`, `oauth_refresh_token`, `oauth_access_token`,
`oauth_consent`, `oauth_client_assertion` (Better Auth's schema; drift test in `auth.int.test.ts`) — migration 0010;
`cgp_drafts`, `mcp_tool_calls` — 0011; session FK set null — 0012. The provider seeds `oauth_resource` at start-up,
so migrations must run before the app serves (they do: `RUN_MIGRATIONS`).

## Tests
`src/server/mcp/mcp.int.test.ts` (full flow: discovery, DCR, login continuation, consent, PKCE, token, refresh
rotation, tools; refusals: foreign redirect, switched redirect, wrong verifier, tampered query, other audience, missing
scope, no org, other org, editor; disconnect; sign-out keeps the connection). `tests/e2e/claude-connect.spec.ts`
(browser consent with a stubbed claude.ai, propose → insert → save → disconnect, axe).

## Owner: connecting
`/app/connect` → copy the URL → Claude: Settings → Connectors → add custom connector → Connect → sign in (open the
mail link in the same browser) → Dovoli. Claude Code: `claude mcp add --transport http postaja <url>`.
