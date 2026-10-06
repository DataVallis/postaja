import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAuth } from "@/server/auth/auth";
import { getRequestContext } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { consentDetails, toQueryString } from "@/server/mcp/oauth-flow";
import { ConsentForm } from "./consent-form";

export const dynamic = "force-dynamic";

/** "Allow Claude to use Postaja?" — reached only through our OAuth provider with a signed query (ADR-038). */
export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = toQueryString(await searchParams);
  const ctx = await getRequestContext();
  if (!ctx) redirect(`/login?${query}`);
  const t = await getTranslations("Connect.consent");
  const details = await consentDetails(getDb(), query, (await getAuth().$context).secret);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <p className="mb-6 text-xl font-bold tracking-tight">
          postaja<span className="text-signal">.</span>
        </p>
        {!details ? (
          <p role="alert" className="rounded-lg border border-signal px-3 py-2 text-sm">{t("invalid")}</p>
        ) : !ctx.org ? (
          <p role="alert" className="rounded-lg border border-signal px-3 py-2 text-sm">{t("noOrg")}</p>
        ) : (
          <>
            <h1 className="mb-2 text-2xl font-bold">{t("title", { client: details.clientName })}</h1>
            <p className="mb-4 text-muted">{t("who", { email: ctx.user.email, org: ctx.org.orgName })}</p>
            <ul className="mb-4 grid gap-1 rounded-xl border border-muted/30 p-4 text-sm">
              <li>✓ {t("canRead")}</li>
              {ctx.org.role === "owner" ? <li>✓ {t("canPropose")}</li> : null}
              {ctx.org.role === "owner" ? <li>✓ {t("canAdd")}</li> : null}
              <li>✗ {t("cannot")}</li>
            </ul>
            <p className="mb-6 text-sm text-muted">{t("redirect", { host: details.redirectHost })}</p>
            <ConsentForm query={details.query} />
          </>
        )}
      </div>
    </main>
  );
}
