import Image from "next/image";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAuth } from "@/server/auth/auth";
import { getCurrentUser } from "@/server/auth/session";
import { oauthContinuation, toQueryString } from "@/server/mcp/oauth-flow";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

export default async function LoginPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  // Claude connecting (ADR-038): the OAuth provider sends a signed authorize query here. After sign-in the magic
  // link lands back on that authorize request, which then asks for consent.
  const oauth = search.sig ? await oauthContinuation(toQueryString(search), (await getAuth().$context).secret) : null;
  if (await getCurrentUser()) redirect(oauth ?? "/app");
  const t = await getTranslations("Login");
  const error = typeof search.error === "string" ? search.error : undefined;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8">
        <h1 className="mb-2 flex items-center gap-2 text-3xl font-bold tracking-tight">
          <Image src="/mark.svg" alt="" width={32} height={32} />
          <span>postaja<span className="text-signal">.</span></span>
        </h1>
        <p className="mb-6 text-muted">{oauth ? t("oauthIntro") : t("intro")}</p>
        {error ? (
          <p role="alert" className="mb-4 rounded-lg border border-signal px-3 py-2 text-sm">
            {t("linkInvalid")}
          </p>
        ) : null}
        {search.sig && !oauth ? (
          <p role="alert" className="mb-4 rounded-lg border border-signal px-3 py-2 text-sm">
            {t("oauthExpired")}
          </p>
        ) : null}
        <LoginForm callbackURL={oauth ?? "/app"} />
      </div>
    </main>
  );
}
