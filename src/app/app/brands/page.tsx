import { Layers, Plus } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, DataTable, EmptyState, LinkButton, PageHeader, td } from "@/components/ui";
import { requireOrgPage } from "@/server/auth/require";
import { listBrands } from "@/server/brands/service";
import { getDb } from "@/server/db/client";
import { brandStats } from "@/server/posts/overview";

export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  const { org } = await requireOrgPage();
  const t = await getTranslations("Brands");
  const f = await getFormatter();
  const db = getDb();
  const [list, stats] = await Promise.all([listBrands(db, org), brandStats(db, org)]);
  const isOwner = org.role === "owner";
  const newButton = isOwner ? <LinkButton href="/app/brands/new" variant="primary"><Plus aria-hidden className="size-4" />{t("new")}</LinkButton> : null;
  return (
    <>
      <PageHeader title={t("title")} description={t("listDescription")} actions={list.length ? newButton : null} />
      {list.length === 0 ? (
        <EmptyState icon={<Layers aria-hidden className="size-8" />} title={t("emptyTitle")} text={isOwner ? t("emptyOwner") : t("emptyEditor")} action={newButton} />
      ) : (
        <DataTable testId="brand-list" head={[t("table.brand"), t("table.languages"), t("table.channels"), t("table.posts"), t("table.waiting"), t("table.lastPost")]}>
          {list.map((b) => {
            const s = stats.get(b.id);
            return (
              <tr key={b.id}>
                <td className={td}>
                  <Link href={`/app/brands/${b.id}`} className="font-semibold hover:underline">{b.name}</Link>
                  <div className="text-xs text-muted">/{b.slug}{b.website ? ` · ${b.website.replace(/^https?:\/\//, "")}` : ""}</div>
                </td>
                <td className={td}>{b.languages.map((l) => <span key={l} className="mr-1 inline-block rounded bg-raised px-1.5 py-0.5 text-xs font-medium uppercase">{l}</span>)}</td>
                <td className={`${td} tabular-nums`}>{s?.channels ?? 0}</td>
                <td className={`${td} tabular-nums`}>{s?.posts ?? 0}</td>
                <td className={td}>{s?.waiting ? <Badge tone="signal" dot>{s.waiting}</Badge> : <span className="text-muted">0</span>}</td>
                <td className={`${td} whitespace-nowrap text-muted`}>{s?.last ? f.dateTime(s.last, { dateStyle: "medium" }) : "—"}</td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </>
  );
}
