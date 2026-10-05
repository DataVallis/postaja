import { headers } from "next/headers";
import { getDb } from "../db/client";
import { resolveOrgContext, TenancyError, type OrgContext } from "../tenancy/context";
import { getAuth } from "./auth";

export type CurrentUser = { id: string; email: string; name: string; role: "user" | "superadmin" };

async function getSessionData() {
  return getAuth().api.getSession({ headers: await headers() });
}

/** Current user from the session cookie, verified server-side. Never trust identity from the client. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const s = await getSessionData();
  if (!s) return null;
  const role = (s.user as { role?: string }).role === "superadmin" ? "superadmin" : "user";
  return { id: s.user.id, email: s.user.email, name: s.user.name, role };
}

/** Current user + verified organization context, or the reason there is none. */
export async function getRequestContext(): Promise<
  { user: CurrentUser; org: OrgContext | null; orgError: TenancyError["code"] | null } | null
> {
  const s = await getSessionData();
  if (!s) return null;
  const role = (s.user as { role?: string }).role === "superadmin" ? "superadmin" : "user";
  const user = { id: s.user.id, email: s.user.email, name: s.user.name, role } as CurrentUser;
  try {
    const org = await resolveOrgContext(getDb(), {
      userId: s.user.id,
      activeOrganizationId: (s.session as { activeOrganizationId?: string | null }).activeOrganizationId,
    });
    return { user, org, orgError: null };
  } catch (e) {
    if (e instanceof TenancyError) return { user, org: null, orgError: e.code };
    throw e;
  }
}
