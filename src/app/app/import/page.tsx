import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, DataTable, PageHeader, Section, td } from "@/components/ui";
import { requireOrgPage } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { listImports } from "@/server/plans/service";
import { PlanUpload } from "./upload";

export const dynamic = "force-dynamic";

const TONE = { draft: "warn", imported: "ok", discarded: "neutral" } as const;

export default async function ImportPage() {
  const { org } = await requireOrgPage();
  const list = await listImports(getDb(), org);
  const t = await getTranslations("Import");
  const f = await getFormatter();
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-8">
        <PlanUpload />
        {list.length ? (
          <Section id="imports-h" title={t("history")}>
            <DataTable testId="imports" head={[t("file"), t("kind"), t("statusCol"), t("created"), t("date")]}>
              {list.map((i) => (
                <tr key={i.id}>
                  <td className={td}><Link href={`/app/import/${i.id}`} className="font-medium hover:underline">{i.filename}</Link></td>
                  <td className={`${td} text-muted`}>{t(`kinds.${i.kind}`)}</td>
                  <td className={td}><Badge tone={TONE[i.status]} dot>{t(`status.${i.status}`)}</Badge></td>
                  <td className={`${td} tabular-nums`}>{i.status === "imported" ? <Link href={`/app/posts?import=${i.id}`} className="hover:underline">{i.createdCount}</Link> : "—"}</td>
                  <td className={`${td} whitespace-nowrap text-muted`}>{f.dateTime(i.createdAt, { dateStyle: "medium", timeStyle: "short" })}</td>
                </tr>
              ))}
            </DataTable>
          </Section>
        ) : null}
      </div>
    </>
  );
}
