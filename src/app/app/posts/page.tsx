import { Search } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, buttonClass, DataTable, inputClass, PageHeader, selectClass, STATUS_TONE, td } from "@/components/ui";
import { requireOrgPage } from "@/server/auth/require";
import { listBrands } from "@/server/brands/service";
import { getDb } from "@/server/db/client";
import { PLATFORMS } from "@/server/db/schema";
import { listOrgPosts, parsePostFilters, POST_STATUSES } from "@/server/posts/overview";

export const dynamic = "force-dynamic";

/** All posts of the organization with search and filters (GET form: shareable URLs, works without JS). */
export default async function PostsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { org } = await requireOrgPage();
  const filters = parsePostFilters(await searchParams);
  const db = getDb();
  const [list, brandList] = await Promise.all([listOrgPosts(db, org, filters), listBrands(db, org)]);
  const t = await getTranslations("PostsList");
  const tp = await getTranslations("Posts");
  const f = await getFormatter();
  const qs = (page: number) => {
    const p = new URLSearchParams();
    if (filters.q) p.set("q", filters.q);
    if (filters.brandId) p.set("brand", filters.brandId);
    if (filters.status) p.set("status", filters.status);
    if (filters.platform) p.set("platform", filters.platform);
    if (filters.importId) p.set("import", filters.importId);
    if (page > 1) p.set("page", String(page));
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const filtered = !!(filters.q || filters.brandId || filters.status || filters.platform || filters.importId);
  const tf = await getTranslations("PostFormats");
  const slot = (d: string | null, time: string | null) => (d ? `${f.dateTime(new Date(`${d}T12:00:00Z`), { weekday: "short", day: "numeric", month: "numeric" })}${time ? ` · ${time}` : ""}` : "—");
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      {filters.importId ? (
        <p className="mb-4 text-sm text-muted" data-testid="import-filter">{t("fromImport")} <Link href={`/app/import/${filters.importId}`} className="underline underline-offset-4">{t("openImport")}</Link></p>
      ) : null}
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2" role="search">
        {filters.importId ? <input type="hidden" name="import" value={filters.importId} /> : null}
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <label htmlFor="q" className="sr-only">{t("search")}</label>
          <input id="q" name="q" defaultValue={filters.q} placeholder={t("search")} className={`${inputClass} pl-9`} />
        </div>
        <label htmlFor="f-brand" className="sr-only">{tp("brand")}</label>
        <select id="f-brand" name="brand" defaultValue={filters.brandId ?? ""} className={selectClass}>
          <option value="">{t("allBrands")}</option>
          {brandList.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <label htmlFor="f-status" className="sr-only">{t("status")}</label>
        <select id="f-status" name="status" defaultValue={filters.status ?? ""} className={selectClass}>
          <option value="">{t("allStatuses")}</option>
          {POST_STATUSES.map((s) => <option key={s} value={s}>{tp(`status.${s}`)}</option>)}
        </select>
        <label htmlFor="f-platform" className="sr-only">{t("platform")}</label>
        <select id="f-platform" name="platform" defaultValue={filters.platform ?? ""} className={selectClass}>
          <option value="">{t("allPlatforms")}</option>
          {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button type="submit" className={buttonClass("secondary")}>{t("apply")}</button>
        {filtered ? <Link href="/app/posts" className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline">{t("clear")}</Link> : null}
      </form>
      <DataTable
        testId="posts-table"
        head={[t("slot"), tp("post"), tp("brand"), tp("channel"), t("format"), t("status")]}
        empty={list.rows.length ? undefined : filtered ? t("noMatch") : t("empty")}
      >
        {list.rows.map((p) => (
          <tr key={p.id}>
            <td className={`${td} whitespace-nowrap text-muted`} title={f.dateTime(p.createdAt, { dateStyle: "medium", timeStyle: "short" })}>{slot(p.scheduledOn, p.scheduledTime)}</td>
            <td className={`${td} min-w-56 max-w-lg`}>
              <Link href={`/app/posts/${p.id}`} className="line-clamp-1 font-medium hover:underline">{p.caption?.split("\n")[0] || p.topic || p.brief}</Link>
              <div className="line-clamp-1 text-xs text-muted">{p.topic ?? p.brief}</div>
            </td>
            <td className={td}><Link href={`/app/brands/${p.brandId}`} className="hover:underline">{p.brandName}</Link></td>
            <td className={`${td} whitespace-nowrap text-muted`}>{p.platform ? `${p.platform} · ${p.handle}` : "—"}</td>
            <td className={`${td} whitespace-nowrap`}>{tf(p.format)}</td>
            <td className={td}><Badge tone={STATUS_TONE[p.status]} dot>{tp(`status.${p.status}`)}</Badge></td>
          </tr>
        ))}
      </DataTable>
      {list.pages > 1 ? (
        <nav aria-label={t("pagination")} className="mt-4 flex items-center justify-between text-sm text-muted">
          <span>{t("pageOf", { page: list.page, pages: list.pages, total: list.total })}</span>
          <span className="flex gap-2">
            {list.page > 1 ? <Link className={buttonClass("secondary", "sm")} href={`/app/posts${qs(list.page - 1)}`}>{t("prev")}</Link> : null}
            {list.page < list.pages ? <Link className={buttonClass("secondary", "sm")} href={`/app/posts${qs(list.page + 1)}`}>{t("next")}</Link> : null}
          </span>
        </nav>
      ) : null}
    </>
  );
}
