import { FileText, Layers, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, DataTable, EmptyState, LinkButton, PageHeader, Section, Stat, STATUS_TONE, td } from "@/components/ui";
import { getRequestContext } from "@/server/auth/session";
import { listBrands } from "@/server/brands/service";
import { getDb } from "@/server/db/client";
import { listOrgPosts, orgOverview } from "@/server/posts/overview";
import { calendarPosts } from "@/server/posts/calendar";
import { todayIn } from "@/lib/dates";
import Link from "next/link";

export const dynamic = "force-dynamic";

const usd = (micro: bigint) => (Number(micro) / 1_000_000).toFixed(2);

export default async function Dashboard() {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/login");
  const { user, org, orgError } = ctx;
  const t = await getTranslations("Dashboard");
  const tp = await getTranslations("Posts");
  const ta = await getTranslations("App");
  const f = await getFormatter();
  const superBadge = user.role === "superadmin" ? <Badge tone="signal">{ta("superadmin")}</Badge> : null;

  if (!org) {
    return (
      <>
        <PageHeader title={t("title")} description={<>{ta("signedInAs")} <strong data-testid="user-email">{user.email}</strong></>} actions={superBadge} />
        <EmptyState title={<span data-testid="no-org">{orgError === "ORG_SUSPENDED" ? ta("orgSuspended") : ta("noOrg")}</span>} text={user.role === "superadmin" ? t("superadminHint") : undefined}
          action={user.role === "superadmin" ? <LinkButton href="/admin" variant="primary">{ta("adminLink")}</LinkButton> : undefined} />
      </>
    );
  }

  const db = getDb();
  const today = todayIn();
  const [o, recent, brandList, todays] = await Promise.all([orgOverview(db, org), listOrgPosts(db, org, {}), listBrands(db, org), calendarPosts(db, org, today, today)]);
  const isOwner = org.role === "owner";
  return (
    <>
      <PageHeader
        title={t("title")}
        description={<>{ta("signedInAs")} <strong data-testid="user-email">{user.email}</strong> · <span data-testid="org">{org.orgName} · {ta(`roles.${org.role}`)} · {ta(`plans.${org.plan}`)}</span></>}
        actions={<>{superBadge}{brandList.length ? <LinkButton href="/app/posts" variant="primary"><FileText aria-hidden className="size-4" />{t("allPosts")}</LinkButton> : null}</>}
      />

      {brandList.length === 0 ? (
        <EmptyState
          icon={<Layers aria-hidden className="size-8" />}
          title={t("noBrandsTitle")}
          text={isOwner ? t("noBrandsOwner") : t("noBrandsEditor")}
          action={isOwner ? <LinkButton href="/app/brands/new" variant="primary"><Plus aria-hidden className="size-4" />{t("createBrand")}</LinkButton> : undefined}
        />
      ) : (
        <div className="grid gap-8">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="stats">
            <Stat label={t("stats.planned")} value={o.planned} href="/app/posts?status=planned" />
            <Stat label={t("stats.ready")} value={o.ready} href="/app/posts?status=ready" />
            <Stat label={t("stats.needsReview")} value={o.needsReview} href="/app/posts?status=needs_review" />
            <Stat label={t("stats.approved")} value={o.approved} href="/app/posts?status=approved" />
            <Stat label={t("stats.published")} value={o.publishedThisMonth} hint={t("stats.thisMonth")} />
            <Stat label={t("stats.spend")} value={`${usd(o.spentMicroUsd)} €`} hint={t("stats.ofCap", { cap: usd(o.capMicroUsd) })} />
          </div>

          <Section id="today-h" title={t("today")} description={t("todayHint", { n: todays.length })}
            actions={
              <span className="flex flex-wrap items-center gap-3">
                {todays.length ? <a href={`/api/plan/download?date=${today}`} className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline" data-testid="today-zip">{t("downloadToday")}</a> : null}
                <Link href={`/app/plan?view=day`} className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline">{t("openPlan")}</Link>
              </span>
            }>
            {todays.length ? (
              <DataTable testId="today-posts" head={[t("time"), tp("post"), tp("brand"), tp("channel"), t("status")]}>
                {todays.map((p) => (
                  <tr key={p.id}>
                    <td className={`${td} whitespace-nowrap text-muted`}>{p.scheduledTime ?? "—"}</td>
                    <td className={`${td} min-w-48 max-w-md`}><Link href={`/app/posts/${p.id}`} className="line-clamp-1 font-medium hover:underline">{p.caption?.split("\n")[0] || p.topic || p.brief}</Link></td>
                    <td className={td}>{p.brandName}</td>
                    <td className={`${td} whitespace-nowrap text-muted`}>{p.platform ? `${p.platform} · ${p.handle}` : "—"}</td>
                    <td className={td}><Badge tone={STATUS_TONE[p.status]} dot>{tp(`status.${p.status}`)}</Badge></td>
                  </tr>
                ))}
              </DataTable>
            ) : null}
          </Section>

          <Section id="recent-h" title={t("recent")} actions={<Link href="/app/posts" className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline">{t("seeAll")}</Link>}>
            <DataTable
              testId="recent-posts"
              head={[tp("post"), tp("brand"), tp("channel"), t("status"), t("created")]}
              empty={recent.rows.length ? undefined : t("noPosts")}
            >
              {recent.rows.slice(0, 8).map((p) => (
                <tr key={p.id}>
                  <td className={`${td} min-w-48 max-w-md`}><Link href={`/app/posts/${p.id}`} className="line-clamp-1 font-medium hover:underline">{p.caption?.split("\n")[0] || p.brief}</Link></td>
                  <td className={td}>{p.brandName}</td>
                  <td className={`${td} text-muted`}>{p.platform ? `${p.platform} · ${p.handle}` : "—"}</td>
                  <td className={td}><Badge tone={STATUS_TONE[p.status]} dot>{tp(`status.${p.status}`)}</Badge></td>
                  <td className={`${td} whitespace-nowrap text-muted`}>{f.dateTime(p.createdAt, { dateStyle: "medium", timeStyle: "short" })}</td>
                </tr>
              ))}
            </DataTable>
          </Section>

          <Section id="brands-h" title={t("brands")} actions={<Link href="/app/brands" className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline">{t("seeAll")}</Link>}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {brandList.slice(0, 6).map((b) => (
                <Link key={b.id} href={`/app/brands/${b.id}`} className="rounded-xl border border-line bg-surface p-4 transition hover:border-muted">
                  <div className="font-semibold">{b.name}</div>
                  <div className="mt-1 text-sm text-muted">/{b.slug} · {b.languages.join(", ")}</div>
                </Link>
              ))}
            </div>
          </Section>
        </div>
      )}
    </>
  );
}
