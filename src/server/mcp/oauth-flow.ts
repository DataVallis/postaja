// Glue between Better Auth's OAuth provider and our magic-link login + consent page (TASK-010, ADR-038).
// The provider sends the browser to /login or /connect/consent with the original authorize query, signed (sig, exp).
// We only act on a query whose signature verifies with our secret, so nobody can craft a login link that ends at a
// foreign redirect: the redirect_uri inside was already checked by the provider (Claude callbacks only).
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { oauthClient } from "../db/schema";

/** Parameters the provider adds when it signs a query; they are not part of the client's original request. */
const SIGNING_PARAMS = ["sig", "exp", "ba_iat", "ba_pl", "ba_param"];

export function toQueryString(search: Record<string, string | string[] | undefined> | URLSearchParams | string): string {
  if (typeof search === "string") return search.replace(/^\?/, "");
  if (search instanceof URLSearchParams) return search.toString();
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
    else if (v !== undefined) p.append(k, v);
  }
  return p.toString();
}

/** True for a query that came from our provider (signature valid, not expired). */
export async function isSignedOAuthQuery(query: string, secret: string): Promise<boolean> {
  if (!query || !new URLSearchParams(query).has("sig")) return false;
  return verifyOAuthQueryParams(query, secret).catch(() => false);
}

/**
 * Where the magic link should land after sign-in: the original authorize request, so the provider continues with
 * consent and the code. `prompt=login` is dropped — the person has just signed in. Null when the query is not ours.
 */
export async function oauthContinuation(query: string, secret: string): Promise<string | null> {
  if (!(await isSignedOAuthQuery(query, secret))) return null;
  const p = new URLSearchParams(query);
  for (const k of SIGNING_PARAMS) p.delete(k);
  const prompt = (p.get("prompt") ?? "").split(" ").filter((x) => x && x !== "login" && x !== "select_account");
  if (prompt.length) p.set("prompt", prompt.join(" "));
  else p.delete("prompt");
  return `/api/auth/oauth2/authorize?${p.toString()}`;
}

export type ConsentDetails = { clientName: string; redirectHost: string; scopes: string[]; query: string };

/** What the consent page shows: the registered client's name and where the browser will be sent. */
export async function consentDetails(db: Db, query: string, secret: string): Promise<ConsentDetails | null> {
  if (!(await isSignedOAuthQuery(query, secret))) return null;
  const p = new URLSearchParams(query);
  const clientId = p.get("client_id");
  const redirect = p.get("redirect_uri");
  if (!clientId || !redirect) return null;
  const [c] = await db.select({ name: oauthClient.name, disabled: oauthClient.disabled }).from(oauthClient).where(eq(oauthClient.clientId, clientId));
  if (!c || c.disabled) return null;
  let redirectHost: string;
  try {
    redirectHost = new URL(redirect).host;
  } catch {
    return null;
  }
  return { clientName: (c.name ?? "").trim() || "Claude", redirectHost, scopes: (p.get("scope") ?? "").split(" ").filter(Boolean), query };
}
