// Discovery documents Claude fetches before connecting (RFC 9728 protected resource, RFC 8414 / OIDC authorization
// server). Better Auth serves them; this maps each root /.well-known URL to it (TASK-010, ADR-038).
import { oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import type { Auth } from "../auth/auth";

export async function wellKnown(auth: Auth, req: Request): Promise<Response> {
  const path = new URL(req.url).pathname.replace(/\/$/, "");
  // The OIDC path-suffixed form is not routed by the auth handler; the provider exports a handler for it.
  if (path === "/.well-known/openid-configuration/api/auth") return oauthProviderOpenIdConfigMetadata(auth)(req);
  return auth.handler(req);
}
