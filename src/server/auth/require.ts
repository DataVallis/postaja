import { redirect } from "next/navigation";
import type { OrgContext } from "../tenancy/context";
import { getRequestContext, type CurrentUser } from "./session";

/** For /app pages: signed in + verified organization, otherwise redirect (login) or show the no-org state. */
export async function requireOrgPage(): Promise<{ user: CurrentUser; org: OrgContext }> {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/login");
  if (!ctx.org) redirect("/app");
  return { user: ctx.user, org: ctx.org };
}

/** For server actions: same checks, but returns null instead of redirecting so the action can answer. */
export async function orgContextForAction(): Promise<OrgContext | null> {
  const ctx = await getRequestContext();
  return ctx?.org ?? null;
}
