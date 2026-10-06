import { getFormatter, getTranslations } from "next-intl/server";
import { requireSuperadmin } from "@/server/admin/guard";
import { listAudit } from "@/server/admin/queries";
import { getDb } from "@/server/db/client";

export default async function AuditPage() {
  await requireSuperadmin();
  const t = await getTranslations("Admin");
  const f = await getFormatter();
  const rows = await listAudit(getDb());
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">{t("audit")}</h1>
      {rows.length === 0 ? (
        <p className="text-muted">{t("noAudit")}</p>
      ) : (
        <ul className="grid gap-2 text-sm" data-testid="audit">
          {rows.map((r) => (
            <li key={r.id} className="border-t border-line pt-2">
              <span className="text-muted">{f.dateTime(r.createdAt, { dateStyle: "short", timeStyle: "medium" })}</span>{" "}
              <strong>{r.action}</strong> {r.orgName ? `· ${r.orgName}` : ""} {r.target ? `· ${r.target}` : ""}{" "}
              <span className="text-muted">· {r.actor}</span>
              <code className="mt-1 block break-all text-xs text-muted">{JSON.stringify(r.meta)}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
