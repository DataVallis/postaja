import { AppShell } from "@/components/shell/app-shell";
import { requireSuperadmin } from "@/server/admin/guard";
import { getRequestContext } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/** Super-admin pages share the app frame; the admin section of the sidebar is shown only to super admins. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireSuperadmin();
  const ctx = (await getRequestContext())!;
  return (
    <AppShell user={ctx.user} orgName={ctx.org?.orgName} hasOrg={!!ctx.org}>
      {children}
    </AppShell>
  );
}
