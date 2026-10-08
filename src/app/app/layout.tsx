import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getRequestContext } from "@/server/auth/session";
import { CreditBanner } from "./credit-banner";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/login");
  return (
    <AppShell user={ctx.user} orgName={ctx.org?.orgName} hasOrg={!!ctx.org}>
      {ctx.org ? <CreditBanner orgId={ctx.org.orgId} /> : null}
      {children}
    </AppShell>
  );
}
