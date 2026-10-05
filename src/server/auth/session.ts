import { headers } from "next/headers";
import { getAuth } from "./auth";

export type CurrentUser = { id: string; email: string; name: string; role: "user" | "superadmin" };

/** Current user from the session cookie, verified server-side. Never trust identity from the client. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const s = await getAuth().api.getSession({ headers: await headers() });
  if (!s) return null;
  const role = (s.user as { role?: string }).role === "superadmin" ? "superadmin" : "user";
  return { id: s.user.id, email: s.user.email, name: s.user.name, role };
}
