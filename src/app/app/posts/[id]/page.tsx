import Link from "next/link";
import { Download } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, buttonClass, Card, inputClass, PageHeader, STATUS_TONE } from "@/components/ui";
import { microToUsd } from "@/lib/money/usd";
import { requireOrgPage } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import type { PostStatus } from "@/server/db/schema";
import { getPost, postCost, PostError, rulesFor } from "@/server/posts/generate";
import { reschedulePostAction, retryPostAction, setPostStatusAction, writePlannedPostAction } from "../actions";
import { PostEditor } from "../editor";
import { listPostMedia } from "@/server/images/service";
import { currentDesign } from "@/server/design/service";
import { templateSlots } from "@/server/design/spec";
import { wantsPdf } from "@/server/download/service";
import { ImagesSection } from "./images-section";

export const dynamic = "force-dynamic";

const NEXT: Partial<Record<PostStatus, PostStatus[]>> = {
  ready: ["approved", "skipped"],
  needs_review: ["approved", "skipped"],
  approved: ["published", "skipped", "ready"],
  published: ["approved"],
  skipped: ["ready"],
  failed: ["skipped"],
  planned: ["skipped"],
};

export default async function PostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ slotError?: string; imageError?: string }> }) {
  const { org } = await requireOrgPage();
  const { id } = await params;
  const { slotError, imageError } = await searchParams;
  const db = getDb();
  const post = await getPost(db, org, id).catch((e) => {
    if (e instanceof PostError) notFound();
    throw e;
  });
  const t = await getTranslations("Posts");
  const f = await getFormatter();
  const ctx = post.channelId ? await rulesFor(db, org, post.brandId, post.channelId).catch(() => null) : null;
  const cost = await postCost(db, org, post.id);
  const media = await listPostMedia(db, org, post.id);
  const design = await currentDesign(db, org, post.brandId);
  const templates = design?.spec ? design.spec.templates.map((tp) => ({ id: tp.id, name: tp.name, slots: templateSlots(tp) })) : null;
  const editable = post.status === "planned" || post.status === "ready" || post.status === "needs_review" || post.status === "approved";
  const tf = await getTranslations("PostFormats");
  const ti = await getTranslations("Import");
  const plan = post.plan ?? {};
  const next = (NEXT[post.status] ?? []).map((to) => (post.status === "skipped" && to === "ready" && !post.content ? "planned" : to));
  const facts: [string, React.ReactNode][] = [
    [t("planSlot"), post.scheduledOn ? `${f.dateTime(new Date(`${post.scheduledOn}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}${post.scheduledTime ? ` · ${post.scheduledTime}` : ""}` : null],
    [t("planFormat"), `${tf(post.format)}${plan.slideCount ? ` · ${t("slidesN", { n: plan.slideCount })}` : ""}`],
    [ti("fields.topic"), plan.topic], [ti("fields.category"), plan.category], [ti("fields.audience"), plan.audience], [ti("fields.account"), plan.account],
    [ti("fields.cta"), plan.cta], [ti("fields.link"), plan.link], [ti("fields.first_comment"), plan.firstComment],
    [ti("fields.overlay_text"), plan.overlayText], [ti("fields.image_prompt"), plan.imagePrompt], [ti("fields.notes"), plan.notes],
    [t("publishedAt"), post.publishedAt ? f.dateTime(post.publishedAt, { dateStyle: "medium" }) : null],
    [t("planSource"), post.importId ? <Link href={`/app/import/${post.importId}`} className="underline underline-offset-4">{plan.sourceRef ?? t("planImport")}</Link> : null],
  ];
  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow={<Link href={`/app/brands/${post.brandId}`} className="hover:text-fg hover:underline">← {ctx?.brand.name ?? t("brand")}</Link>}
        title={<span className="flex flex-wrap items-center gap-3">{ctx ? `${ctx.channel.platform} · ${ctx.channel.handle}` : t("post")}<span data-testid="status" className="text-base font-normal"><Badge tone={STATUS_TONE[post.status]} dot>{t(`status.${post.status}`)}</Badge></span></span>}
        description={<>{t("briefWas")}: {post.brief}</>}
        actions={post.content || media.length ? (
          <a href={`/api/posts/${post.id}/download`} className={buttonClass("secondary", "sm")} data-testid="post-zip">
            <Download aria-hidden className="size-4" />{t("downloadZip")}
          </a>
        ) : null}
      />
      {post.status === "failed" ? (
        <div role="alert" className="grid justify-items-start gap-3 rounded-xl border border-signal p-4">
          <p>{t(`errors.${post.error ?? "FAILED"}`)}</p>
          <form action={retryPostAction}>
            <input type="hidden" name="postId" value={post.id} />
            <button type="submit" className={buttonClass("primary")}>{t("retry")}</button>
          </form>
        </div>
      ) : null}

      {post.ruleFailures.length ? (
        <div className="grid gap-2 rounded-xl border border-signal/60 bg-signal/10 p-4 text-sm" data-testid="failures">
          <p className="font-semibold">{t("failuresTitle")}</p>
          <ul className="grid gap-1">
            {post.ruleFailures.map((v, i) => (
              <li key={i}>{t(`violations.${v.code}`, { actual: String(v.actual), limit: String(v.limit), part: v.part ?? 0 })}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {post.status === "planned" && !post.content ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-signal/40 p-4" data-testid="planned-hint">
          <p className="text-sm">{t("plannedHint")}</p>
          <form action={writePlannedPostAction}>
            <input type="hidden" name="postId" value={post.id} />
            <button type="submit" className={buttonClass("primary")}>{t("writeWithAi")}</button>
          </form>
        </Card>
      ) : null}
      {ctx && (post.content || post.status === "planned") ? (
        <Card className="p-5"><PostEditor key={post.content ? "text" : "empty"} postId={post.id} caption={post.content?.caption ?? ""} parts={post.content?.parts} rules={ctx.rules} readOnly={!editable} /></Card>
      ) : null}

      <ImagesSection
        postId={post.id}
        status={post.mediaStatus}
        error={post.mediaError}
        media={media}
        visual={post.visual}
        templates={templates}
        aiConfigured={!!process.env.FAL_KEY}
        requestError={imageError}
        designHref={`/app/brands/${post.brandId}?tab=design`}
        pdf={wantsPdf(ctx?.channel.platform ?? null, media.length)}
      />

      <Card className="p-5" data-testid="plan">
        <h2 className="mb-3 text-base font-semibold">{t("planTitle")}</h2>
        {post.status !== "published" ? (
          <form action={reschedulePostAction} className="mb-4 flex flex-wrap items-end gap-3 border-b border-line pb-4" data-testid="slot-form">
            <input type="hidden" name="postId" value={post.id} />
            <div className="grid gap-1">
              <label htmlFor="slot-date" className="text-sm font-medium">{t("slotDate")}</label>
              <input id="slot-date" name="date" type="date" defaultValue={post.scheduledOn ?? ""} className={`${inputClass} w-44`} />
            </div>
            <div className="grid gap-1">
              <label htmlFor="slot-time" className="text-sm font-medium">{t("slotTime")}</label>
              <input id="slot-time" name="time" type="time" defaultValue={post.scheduledTime ?? ""} className={`${inputClass} w-32`} />
            </div>
            <button type="submit" className={buttonClass("secondary")}>{t("slotSave")}</button>
            {slotError ? <p role="alert" className="text-sm text-danger">{t("slotInvalid")}</p> : null}
          </form>
        ) : null}
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[12rem_1fr]">
          {facts.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="whitespace-pre-line break-words">{v}</dd>
            </div>
          ))}
          {plan.slides?.length ? (
            <div className="contents">
              <dt className="text-muted">{ti("fields.slides")}</dt>
              <dd><ol className="grid list-decimal gap-1 pl-5">{plan.slides.map((sl, i) => <li key={i} className="whitespace-pre-line">{sl}</li>)}</ol></dd>
            </div>
          ) : null}
        </dl>
      </Card>

      <div className="flex flex-wrap gap-2">
        {next.map((to) => (
          <form key={to} action={setPostStatusAction}>
            <input type="hidden" name="postId" value={post.id} />
            <input type="hidden" name="to" value={to} />
            <button type="submit" className={buttonClass(to === "approved" ? "primary" : "secondary", "sm")}>{t(`to.${to}`)}</button>
          </form>
        ))}
      </div>

      <p className="text-xs text-muted">
        {f.dateTime(post.createdAt, { dateStyle: "medium", timeStyle: "short" })} · {post.model} · {t("cost", { usd: microToUsd(cost, 4) })}
        {post.fixAttempts ? ` · ${t("fixed")}` : ""}
      </p>
    </div>
  );
}
