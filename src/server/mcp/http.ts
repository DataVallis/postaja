// The MCP HTTP entry, independent of Next.js so integration tests can drive it with real Requests (ADR-038).
// Access tokens are JWTs from our own Better Auth OAuth provider. They are verified in-process against the local
// JWKS (no HTTP round trip to ourselves): signature, issuer, audience = this exact MCP URL, expiry, and the
// "postaja" scope. Anything else gets the RFC 9728 challenge that tells Claude where to authorize.
import { verifyJwsAccessToken } from "better-auth/oauth2";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { MCP_SCOPE, mcpResource, type Auth } from "../auth/auth";
import type { Db } from "../db/client";
import type { Storage } from "../files/storage";
import { hasConnection } from "./connections";
import { buildMcpServer } from "./server";
import { McpError, mcpContext } from "./service";

export type McpHttpDeps = { db: Db; storage: Storage; appUrl: string };

/** Where Claude finds the protected-resource metadata (RFC 9728 §3.1: well-known prefix + resource path). */
export const resourceMetadataUrl = (appUrl: string) => `${appUrl.replace(/\/$/, "")}/.well-known/oauth-protected-resource/api/mcp`;

const rpcError = (status: number, message: string, headers?: HeadersInit) => {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json");
  h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }), { status, headers: h });
};

export type McpClaims = { sub: string; clientId: string; scopes: string[] };

/** Why a request was refused: no/invalid token → 401, token without the "postaja" scope → 403. */
export class McpAuthError extends Error {
  constructor(public readonly kind: "missing" | "invalid" | "scope", message: string) {
    super(message);
  }
}

/** Verifies `Authorization: Bearer <jwt>`; throws McpAuthError for anything that is not a valid Postaja MCP token. */
export async function verifyMcpToken(auth: Auth, req: Request, appUrl: string, jwksKey: object): Promise<McpClaims> {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+([A-Za-z0-9\-_.~+/]+=*)$/i);
  if (!m) throw new McpAuthError("missing", "Authorization required.");
  const ctx = await auth.$context;
  let payload: Record<string, unknown>;
  try {
    payload = await verifyJwsAccessToken(m[1], {
      jwksFetch: async () => (await auth.api.getJwks()) as never,
      jwksCacheKey: jwksKey,
      verifyOptions: { issuer: ctx.baseURL, audience: mcpResource(appUrl) },
    });
  } catch {
    throw new McpAuthError("invalid", "The access token is invalid or expired.");
  }
  // DPoP-bound tokens would need a proof we do not check; Claude does not use DPoP, so they are refused outright.
  if (payload.cnf) throw new McpAuthError("invalid", "Sender-constrained tokens are not supported.");
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!sub) throw new McpAuthError("invalid", "The access token has no subject.");
  const scopes = String(payload.scope ?? "").split(" ").filter(Boolean);
  if (!scopes.includes(MCP_SCOPE)) throw new McpAuthError("scope", `The access token lacks the "${MCP_SCOPE}" scope.`);
  return { sub, clientId: String(payload.azp ?? payload.client_id ?? "unknown"), scopes };
}

/** RFC 6750 / RFC 9728 challenge: tells Claude where the protected-resource metadata is and which scope to ask for. */
export function challenge(e: McpAuthError, appUrl: string): Response {
  const meta = `resource_metadata="${resourceMetadataUrl(appUrl)}"`;
  const scope = `scope="${MCP_SCOPE}"`;
  if (e.kind === "scope") return rpcError(403, e.message, { "WWW-Authenticate": `Bearer error="insufficient_scope", ${scope}, ${meta}` });
  const www = e.kind === "invalid" ? `Bearer error="invalid_token", ${meta}, ${scope}` : `Bearer ${meta}, ${scope}`;
  return rpcError(401, e.message, { "WWW-Authenticate": www });
}

export function createMcpHttpHandler(auth: Auth, deps: McpHttpDeps) {
  const jwksKey = {};
  return async (req: Request): Promise<Response> => {
    let claims: McpClaims;
    try {
      claims = await verifyMcpToken(auth, req, deps.appUrl, jwksKey);
    } catch (e) {
      if (e instanceof McpAuthError) return challenge(e, deps.appUrl);
      throw e;
    }
    // Disconnected on the Claude page → refused immediately, even with an unexpired access token.
    if (!(await hasConnection(deps.db, claims.sub, claims.clientId))) return challenge(new McpAuthError("invalid", "This Claude connection was removed in Postaja."), deps.appUrl);
    let ctx;
    try {
      ctx = await mcpContext(deps.db, claims.sub);
    } catch (e) {
      return rpcError(403, e instanceof McpError ? e.message : "No organization.");
    }
    const handler = createMcpHandler(() => buildMcpServer({ db: deps.db, storage: deps.storage, appUrl: deps.appUrl, ctx, clientId: claims.clientId }));
    return handler.fetch(req);
  };
}
