import { getFormatter, getTranslations } from "next-intl/server";
import { requireOrgPage } from "@/server/auth/require";
import { mcpResource } from "@/server/auth/auth";
import { getDb } from "@/server/db/client";
import { listConnections } from "@/server/mcp/connections";
import { recentToolCalls } from "@/server/mcp/service";
import { revokeConnectionAction } from "./actions";
import { CopyField } from "./copy-field";

export const dynamic = "force-dynamic";

const appUrl = () => (process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** How to connect Claude to Postaja, which Claude apps are connected, and what they did lately (TASK-010, ADR-038). */
export default async function ConnectPage() {
  const { user, org } = await requireOrgPage();
  const db = getDb();
  const [connections, calls] = await Promise.all([listConnections(db, user.id), recentToolCalls(db, org, 20)]);
  const t = await getTranslations("Connect");
  const f = await getFormatter();
  const url = mcpResource(appUrl());
  const when = (d: Date | null) => (d ? f.dateTime(d, { dateStyle: "medium", timeStyle: "short" }) : "");
  return (
    <main className="grid gap-10">
      <div>
        <h1 className="mb-2 text-2xl font-bold">{t("title")}</h1>
        <p className="max-w-2xl text-muted">{t("intro")}</p>
      </div>

      <section aria-labelledby="how-h" className="grid gap-4">
        <h2 id="how-h" className="text-lg font-semibold">{t("howTitle")}</h2>
        <CopyField label={t("urlLabel")} value={url} />
        <ol className="grid max-w-2xl list-decimal gap-2 pl-5 text-sm">
          <li>{t("step1")}</li>
          <li>{t("step2")}</li>
          <li>{t("step3")}</li>
          <li>{t("step4")}</li>
        </ol>
        <CopyField label={t("codeLabel")} value={`claude mcp add --transport http postaja ${url}`} />
        <p className="max-w-2xl text-sm text-muted">{t("tools")}</p>
        {org.role !== "owner" ? <p className="max-w-2xl text-sm text-muted">{t("editorNote")}</p> : null}
      </section>

      <section aria-labelledby="conn-h">
        <h2 id="conn-h" className="mb-4 text-lg font-semibold">{t("connections")}</h2>
        {connections.length === 0 ? (
          <p className="text-muted">{t("none")}</p>
        ) : (
          <ul className="grid gap-3" data-testid="connections">
            {connections.map((c) => (
              <li key={c.clientId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-muted/30 p-4 text-sm">
                <span>
                  <strong>{c.name || "Claude"}</strong> · {c.redirectUris.some((u) => u.startsWith("https://claude.ai/")) ? "claude.ai" : t("claudeCode")} · {t("since", { when: when(c.since) })}
                </span>
                <form action={revokeConnectionAction}>
                  <input type="hidden" name="clientId" value={c.clientId} />
                  <button type="submit" className="rounded-lg border border-fg/25 px-3 py-1.5 font-medium hover:border-fg/60">{t("disconnect")}</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="log-h">
        <h2 id="log-h" className="mb-4 text-lg font-semibold">{t("activity")}</h2>
        {calls.length === 0 ? (
          <p className="text-muted">{t("noActivity")}</p>
        ) : (
          <ul className="grid gap-1 text-sm" data-testid="tool-calls">
            {calls.map((c) => (
              <li key={c.id}>
                {when(c.createdAt)} · <code>{c.tool}</code> · {c.ok === "ok" ? t("ok") : t("failed", { error: c.error ?? "" })}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
