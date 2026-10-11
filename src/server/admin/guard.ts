import { notFound } from "next/navigation";
import { getCurrentUser } from "../auth/session";
import type { Actor } from "../orgs/service";

/**
 * /admin is invisible to everyone except super admins: anyone else gets a 404 (not 403), so the area is not discoverable.
 * Called in the admin layout, in every admin page and in every admin server action.
 */
export async function requireSuperadmin(): Promise<Actor & { email: string }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "superadmin") notFound();
  return { userId: user.id, role: "superadmin", email: user.email };
}
