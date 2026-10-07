import { FileText, Layers, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, DataTable, EmptyState, LinkButton, PageHeader, Section, Stat, STATUS_TONE, td } from "@/components/ui";
import { getRequestContext } from "@/server/auth/session";
import { listBrands } from "@/server/brands/service";
import { getDb } from "@/server/db/client";
import { listOrgPosts, orgOverview } from "@/server/posts/overview";
import { calendarPosts } from "@/server/posts/calendar";
import { brandStreaks, costsByBrand, todayByChannel } from "@/server/posts/dashboard";
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
  const [o, recent, brandList, todays, perChannel, streaks, costs] = await Promise.all([
    orgOverview(db, org), listOrgPosts(db, org, {}), listBrands(db, org), calendarPosts(db, org, today, today),
    todayByChannel(db, org, today), brandStreaks(db, org, today), costsByBrand(db, org),
  ]);
  const goalBrands = [...new Set(perChannel.map((r) => r.brandId))];
  const totalCost = [...costs.values()].reduce((a, b) => a + b, 0n);
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

          {perChannel.length ? (
            <Section id="goals-h" title={t("goalsTitle")} description={t("goalsHint")}>
              <DataTable testId="today-goals" head={[tp("brand"), tp("channel"), t("goal"), t("planned"), t("doneCol"), t("publishedCol"), t("missing"), t("streak"), ""]}>
                {perChannel.map((r, i) => {
                  const first = perChannel.findIndex((x) => x.brandId === r.brandId) === i;
                  const todo = r.planned - r.done;
                  return (
                    <tr key={r.channelId}>
                      <td className={`${td} font-medium`}>{first ? r.brandName : ""}</td>
                      <td className={`${td} whitespace-nowrap text-muted`}>{r.platform} · {r.handle}</td>
                      <td className={`${td} tabular-nums`}>{r.goal}</td>
                      <td className={`${td} tabular-nums`}>{r.planned}</td>
                      <td className={`${td} tabular-nums`}>{r.done}</td>
                      <td className={`${td} tabular-nums`}>{r.published}</td>
                      <td className={`${td} tabular-nums`}>{r.missing ? <Badge tone="warn">{r.missing}</Badge> : <Badge tone="ok">0</Badge>}</td>
                      <td className={`${td} tabular-nums`} data-testid={first ? "streak" : undefined}>{first ? t("streakDays", { n: streaks.get(r.brandId) ?? 0 }) : ""}</td>
                      <td className={`${td} whitespace-nowrap text-right`}>
                        {todo > 0 ? <Link href={`/app/bulk/new?kind=day&date=${today}&brandId=${r.brandId}&steps=text,image&back=/app`} className="text-sm underline underline-offset-4">{t("create", { n: todo })}</Link> : null}
                        {todo > 0 && r.missing ? " · " : null}
                        {r.missing ? <Link href={`/app/brands/${r.brandId}?tab=posts#ideas`} className="text-sm underline underline-offset-4">{t("suggest")}</Link> : null}
                      </td>
                    </tr>
                  );
                })}
              </DataTable>
              <p className="text-xs text-muted">{t("goalsFoot", { n: goalBrands.length })}</p>
            </Section>
          ) : null}

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

          {costs.size ? (
            <Section id="costs-h" title={t("costsTitle")} description={t("costsHint", { total: usd(totalCost) })}>
              <DataTable testId="brand-costs" head={[tp("brand"), t("costCol")]}>
                {[...costs.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).map(([brandId, micro]) => (
                  <tr key={brandId ?? "none"}>
                    <td className={td}>{brandId ? (brandList.find((b) => b.id === brandId)?.name ?? "—") : <span className="text-muted">{t("noBrandCost")}</span>}</td>
                    <td className={`${td} tabular-nums`}>{micro > 0n && micro < 5_000n ? "< 0.01" : usd(micro)} €</td>
                  </tr>
                ))}
              </DataTable>
            </Section>
          ) : null}

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
