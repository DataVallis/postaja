# TASK-010 — Claude → Postaja over MCP
Depends on: TASK-008
Read first: ADR-035, ADR-038; docs/technical/mcp.md, auth.md, brands.md

## Goal
The owner connects his Claude to Postaja once; in any Claude conversation he can then say "pošlji ta CGP / ta cenik v
Postajo za brand X" and it arrives in Postaja for review. (Owner, 2026-10-06: "claude pošlje podatke na naš MCP".)

## 010a scope (this PR)
OAuth 2.1 provider (`@better-auth/mcp`, `jwt()`), DCR with Claude-only redirects, PKCE, login continuation through the
magic link, consent page, `.well-known` discovery, `/api/mcp` (stateless Streamable HTTP) with `list_brands`,
`get_brand`, `propose_cgp` (pending draft only), `add_material`; `cgp_drafts`, `mcp_tool_calls`; brand-page banner
(insert / discard); `/app/connect` (URL, Claude Code command, connected apps + disconnect, activity).

## 010b scope (done, ADR-046)
~~`create_post`, `list_posts`, `set_post_status`~~ (dropped, ADR-039). Instead: `create_brand` (idempotent), `add_file`
(URL that Postaja downloads behind an SSRF guard, or base64 for small files; same checks as an app upload; kinds logo /
post_example / material / font / auto), `upload_link`; `propose_cgp`, `add_material`, `add_file` create a missing brand
by name (`create_if_missing`, default true). MCP body cap 22 MB.

## Tests
Integration: full OAuth → MCP flow and every refusal (see docs/technical/mcp.md). E2E: browser consent with stubbed
claude.ai, propose → insert → save version → disconnect; axe on /app/connect, consent and brand page.

## Acceptance
On dev the owner adds the connector in Claude, signs in, allows, and a CGP sent from a Claude conversation appears on
the brand page as a proposal he can insert and save.
