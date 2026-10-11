import { ChevronLeft, ChevronRight, ImagePlus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, buttonClass, Card, EmptyState, STATUS_TONE } from "@/components/ui";
import { addDays, addMonths, startOfMonth, stepAnchor } from "@/lib/dates";
import { bulkCandidates } from "@/server/bulk/service";
import type { Db } from "@/server/db/client";
import { calendarPosts } from "@/server/posts/calendar";
import { coverImages, feedChannels } from "@/server/posts/showcase";
import type { OrgContext } from "@/server/tenancy/context";
import { PostTile } from "../post-tile";

/**
 * The month of one channel as its feed will look (TASK-056): posts with images show them, planned posts show their
 * text and that the picture is made on request; the picked post on a phone; images for the next 7 days in one go.
 */
export async function FeedView(props: {
  db: Db; org: OrgContext; anchor: string; today: string; brandId?: string; platform?: string; postId?: string;
  href: (over: Record<string, string | undefined>) => string;
  /** The month / week / day / feed switch of the plan page. */
  views: ReactNode;
}) {
  const t = await getTranslations("Plan.feed");
  const tp = await getTranslations("Posts");
  const fmt = await getFormatter();
  const chans = await feedChannels(props.db, props.org);
  const chosen = chans.find((c) => c.brandId === props.brandId && c.platform === props.platform) ?? null;
  const day = (d: string, o: { weekday?: "long" | "short"; day?: "numeric"; month?: "long" | "numeric" }) => fmt.dateTime(new Date(`${d}T12:00:00Z`), { timeZone: "UTC", ...o });

  const picker = (
    <nav aria-label={t("channelsLabel")} className="flex flex-wrap gap-2" data-testid="feed-channels">
      {chans.map((c) => (
        <Link key={c.id} href={props.href({ brand: c.brandId, platform: c.platform, post: undefined })} aria-current={chosen?.id === c.id ? "page" : undefined}
          className={`rounded-full border px-3 py-1.5 text-sm ${chosen?.id === c.id ? "border-signal bg-signal/10 font-medium text-fg" : "border-line text-muted hover:text-fg"}`}>
          {c.brandName} · {c.platform}
        </Link>
      ))}
    </nav>
  );
  if (!chosen) {
    return (
      <section aria-labelledby="feed-h" className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="feed-h" className="text-lg font-semibold">{t("pickTitle")}</h2>{props.views}</div>
        {chans.length ? picker : <EmptyState title={t("noChannels")} />}
      </section>
    );
  }

  // The calendar month itself (the month grid also shows the edges of the weeks around it).
  const from = startOfMonth(props.anchor);
  const range = { from, to: addDays(addMonths(from, 1), -1) };
  const items = await calendarPosts(props.db, props.org, range.from, range.to, { brandId: chosen.brandId, platform: chosen.platform });
  const [covers, imageTodo] = await Promise.all([
    coverImages(props.db, props.org, items.map((p) => p.id)),
    bulkCandidates(props.db, props.org, { kind: "brand", brandId: chosen.brandId, from: props.today, to: addDays(props.today, 6) }, "image"),
  ]);
  const withImage = items.filter((p) => covers.has(p.id)).length;
  const selected = items.find((p) => p.id === props.postId) ?? items.find((p) => (p.scheduledOn ?? "") >= props.today) ?? items[0] ?? null;
  const label = (p: (typeof items)[number]) => p.caption?.split("\n")[0] || p.topic || p.brief;
  const square = chosen.platform !== "instagram";
  const back = props.href({});

  return (
    <section aria-labelledby="feed-h" className="grid gap-5" data-testid="plan-feed">
      {picker}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={props.href({ d: stepAnchor("month", props.anchor, -1), post: undefined })} className={buttonClass("secondary", "sm")} aria-label={t("prev")}><ChevronLeft aria-hidden className="size-4" /></Link>
          <Link href={props.href({ d: startOfMonth(props.today), post: undefined })} className={buttonClass("secondary", "sm")}>{t("thisMonth")}</Link>
          <Link href={props.href({ d: stepAnchor("month", props.anchor, 1), post: undefined })} className={buttonClass("secondary", "sm")} aria-label={t("next")}><ChevronRight aria-hidden className="size-4" /></Link>
          <h2 id="feed-h" className="ml-2 text-2xl font-bold tracking-tight">
            {chosen.brandName} · <span className="accent-words">{day(range.from, { month: "long" })}</span>
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
        {props.views}
        {imageTodo.length ? (
          <Link href={`/app/bulk/new?kind=brand&brandId=${chosen.brandId}&days=7&steps=image&back=${encodeURIComponent(back)}`} className={buttonClass("primary")} data-testid="feed-images">
            <ImagePlus aria-hidden className="size-4" />{t("imagesWeek", { n: imageTodo.length })}
          </Link>
        ) : null}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <div className="flex flex-wrap items-start gap-10">
          <div className="grid min-w-0 flex-[999_1_520px] gap-3">
            <p className="text-sm text-muted" data-testid="feed-counts">{t("counts", { n: items.length, images: withImage, planned: items.length - withImage, handle: chosen.handle })}</p>
            <ul className="grid grid-cols-3 gap-1.5" data-testid="feed-grid">
              {items.map((p) => (
                <li key={p.id}>
                  <PostTile href={props.href({ post: p.id })} image={covers.get(p.id) ?? null} title={label(p)} noImage={p.status === "published" ? tp("status.published") : t("noImage")} selected={p.id === selected?.id}
                    kicker={p.scheduledOn ? day(p.scheduledOn, { day: "numeric", month: "numeric" }) : undefined} aspect={square ? "1/1" : "4/5"} />
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">{t("hint")}</p>
          </div>

          {selected ? (
            <aside aria-label={t("selected")} className="grid w-full max-w-sm flex-[1_1_340px] gap-4" data-testid="feed-phone">
              <div className="mx-auto w-full max-w-[340px] rounded-[44px] border border-line bg-raised p-3 shadow-2xl shadow-black/40">
                <div className="overflow-hidden rounded-[34px] bg-white text-[#111]">
                  <div className="flex items-center gap-2.5 px-4 pb-2.5 pt-4">
                    <span aria-hidden className="grid size-8 place-items-center rounded-full bg-[#111] text-xs font-bold text-white">{chosen.brandName.slice(0, 1).toUpperCase()}</span>
                    <span className="grid leading-tight"><span className="text-sm font-semibold">{chosen.handle.replace(/^@/, "")}</span><span className="text-[11px] text-[#555]">{chosen.platform}</span></span>
                  </div>
                  {covers.has(selected.id) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- private image behind a short-lived redirect
                    <img src={`/api/post-media/${covers.get(selected.id)}`} alt={label(selected)} className={`w-full object-cover ${square ? "aspect-square" : "aspect-[4/5]"}`} />
                  ) : (
                    <div className={`grid place-items-center gap-3 bg-[repeating-linear-gradient(135deg,#f1f1ee_0_14px,#e9e9e5_14px_28px)] p-6 text-center ${square ? "aspect-square" : "aspect-[4/5]"}`}>
                      <span className="text-xs uppercase tracking-widest text-[#555]">{t("noImageYet")}</span>
                      <span className="text-lg font-bold leading-snug">{selected.topic || label(selected)}</span>
                      <Link href={`/app/posts/${selected.id}#images`} className="inline-flex h-11 items-center rounded-xl bg-[#111] px-4 text-sm font-semibold text-white">{t("makeImage")}</Link>
                    </div>
                  )}
                  <p className="line-clamp-6 whitespace-pre-line px-4 pb-5 pt-3 text-[13px] leading-relaxed">
                    {selected.caption ? <><b>{chosen.handle.replace(/^@/, "")}</b> {selected.caption}</> : <span className="text-[#555]">{t("noText")}</span>}
                  </p>
                </div>
              </div>
              <Card className="grid gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold first-letter:uppercase">{selected.scheduledOn ? day(selected.scheduledOn, { weekday: "short", day: "numeric", month: "numeric" }) : "—"}{selected.scheduledTime ? ` · ${selected.scheduledTime}` : ""}</span>
                  <Badge tone={STATUS_TONE[selected.status]} dot>{tp(`status.${selected.status}`)}</Badge>
                </div>
                <Link href={`/app/posts/${selected.id}`} className={buttonClass("secondary")}>{t("openPost")}</Link>
              </Card>
            </aside>
          ) : null}
        </div>
      )}
    </section>
  );
}
