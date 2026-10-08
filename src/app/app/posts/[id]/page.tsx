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
import { reschedulePostAction, retryPostAction, setPostStatusAction, setPublishedUrlAction, writePlannedPostAction } from "../actions";
import { PostEditor } from "../editor";
import { listImageVersions, listPostMedia } from "@/server/images/service";
import { currentDesign, listPartnerLogos } from "@/server/design/service";
import { templateSlots } from "@/server/design/spec";
import { wantsPdf } from "@/server/download/service";
import { ImagesSection } from "./images-section";
import { AnimationSection } from "./animation-section";
import { animatablePositions, animationEstimate } from "@/server/video/service";
import { PERSONA_DURATIONS, personaVideoEstimate } from "@/server/video/persona";
import { listPostVideos } from "@/server/video/media";
import { getBrandPersona } from "@/server/personas/service";
import { PersonaVideoSection } from "./persona-video-section";

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

export default async function PostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ slotError?: string; imageError?: string; videoError?: string; personaVideoError?: string; statusError?: string }> }) {
  const { org } = await requireOrgPage();
  const { id } = await params;
  const { slotError, imageError, videoError, personaVideoError, statusError } = await searchParams;
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
  const imageVersions = await listImageVersions(db, org, post.id);
  const partnerLogos = await listPartnerLogos(db, org, post.brandId);
  const [animatable, allVideos, animCost] = await Promise.all([animatablePositions(db, org, post), listPostVideos(db, org, post.id), animationEstimate(db, post.brandId)]);
  const tv = await getTranslations("Animation");
  const tpv = await getTranslations("PersonaVideo");
  // Every video stays (TASK-032): animations and persona videos side by side, newest first.
  const animations = allVideos.filter((v) => v.kind === "animation").map((v) => ({
    id: v.id, width: v.width, height: v.height, createdAt: v.createdAt, poster: false, label: tv("videoLabel", { n: (v.slidePosition ?? 0) + 1 }),
  }));
  const design = await currentDesign(db, org, post.brandId);
  // Persona video (TASK-025): offered when the brand has a persona with at least one passport picture.
  const persona = await getBrandPersona(db, org, post.brandId);
  const personaVideo = persona?.images.length
    ? {
        costs: await Promise.all(PERSONA_DURATIONS.map(async (d) => ({ durationS: d, maxCost: await personaVideoEstimate(db, post.brandId, d) }))),
        videos: allVideos.filter((v) => v.kind === "persona").map((v) => {
          const scene = v.spec as { keyframe?: string; motion?: string };
          return {
            id: v.id, width: v.width, height: v.height, createdAt: v.createdAt, poster: !!v.posterKey, label: tpv("videoLabel", { name: persona!.persona.name }),
            details: [scene.keyframe ? { term: tpv("sceneFrame"), text: scene.keyframe } : null, scene.motion ? { term: tpv("sceneMotion"), text: scene.motion } : null].filter((d): d is { term: string; text: string } => !!d),
          };
        }),
      }
    : null;
  const isPersonaVideo = post.videoMode === "persona";
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
    [t("publishedAt"), post.publishedAt ? <>{f.dateTime(post.publishedAt, { dateStyle: "medium" })}{post.publishedUrl ? <> · <a href={post.publishedUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4" data-testid="published-link">{t("openPublished")}</a></> : null}</> : null],
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

      {post.repeatOf && post.status !== "published" ? (
        <div className={`grid gap-1 rounded-xl border p-4 text-sm ${post.repeatOf.blocks ? "border-signal/60 bg-signal/10" : "border-line"}`} data-testid="repeat">
          <p className="font-semibold">{post.repeatOf.blocks ? t("repeatBlocks") : t("repeatWarns")}</p>
          <p>
            <Link href={`/app/posts/${post.repeatOf.postId}`} className="underline underline-offset-4">»{post.repeatOf.label}«</Link>
            {post.repeatOf.date ? ` · ${f.dateTime(new Date(`${post.repeatOf.date}T12:00:00Z`), { dateStyle: "medium" })}` : ""} · {t("repeatScore", { n: Math.round(post.repeatOf.score * 100) })}
          </p>
          {post.repeatOf.blocks ? <p className="text-muted">{t("repeatOverride")}</p> : null}
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
        versions={imageVersions}
        persona={persona?.images.length ? { name: persona.persona.name, checked: post.imagesWithPersona ?? persona.persona.useInPosts } : null}
        partners={{ options: partnerLogos, selected: post.partnerLogoId }}
      />
      {persona && personaVideo ? (
        <PersonaVideoSection
          postId={post.id} brandId={post.brandId} personaName={persona.persona.name}
          status={isPersonaVideo ? post.videoStatus : "none"} error={isPersonaVideo ? post.videoError : null} requestError={personaVideoError}
          wish={isPersonaVideo ? post.videoMotion : null} durationS={isPersonaVideo ? post.videoDurationS : null} costs={personaVideo.costs}
          videos={personaVideo.videos}
        />
      ) : null}
      {animatable.length || animations.length ? (
        <AnimationSection
          postId={post.id} status={isPersonaVideo ? "none" : post.videoStatus} error={isPersonaVideo ? null : post.videoError} requestError={videoError}
          positions={animatable} position={post.videoPosition} motion={isPersonaVideo ? null : post.videoMotion} videos={animations}
          maxCost={animCost}
        />
      ) : null}

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
          <form key={to} action={setPostStatusAction} className={to === "published" ? "flex flex-wrap items-center gap-2" : undefined}>
            <input type="hidden" name="postId" value={post.id} />
            <input type="hidden" name="to" value={to} />
            {to === "published" ? (
              <>
                <label htmlFor="published-url" className="sr-only">{t("publishedUrl")}</label>
                <input id="published-url" name="url" type="url" inputMode="url" placeholder={t("publishedUrlPlaceholder")} className={`${inputClass} h-9 w-72`} />
              </>
            ) : null}
            <button type="submit" className={buttonClass(to === "approved" ? "primary" : "secondary", "sm")}>{t(`to.${to}`)}</button>
          </form>
        ))}
      </div>
      {statusError ? <p role="alert" className="text-sm text-danger">{t(`statusErrors.${statusError === "BAD_URL" ? "BAD_URL" : "FAILED"}`)}</p> : null}
      {post.status === "published" ? (
        <form action={setPublishedUrlAction} className="flex flex-wrap items-end gap-2" data-testid="published-url-form">
          <input type="hidden" name="postId" value={post.id} />
          <div className="grid gap-1">
            <label htmlFor="published-url-edit" className="text-sm font-medium">{t("publishedUrl")}</label>
            <input id="published-url-edit" name="url" type="url" inputMode="url" defaultValue={post.publishedUrl ?? ""} placeholder={t("publishedUrlPlaceholder")} className={`${inputClass} w-96 max-w-full`} />
          </div>
          <button type="submit" className={buttonClass("secondary", "sm")}>{t("savePublishedUrl")}</button>
        </form>
      ) : null}

      <p className="text-xs text-muted">
        {f.dateTime(post.createdAt, { dateStyle: "medium", timeStyle: "short" })} · {post.model} · {t("cost", { usd: microToUsd(cost, 4) })}
        {post.fixAttempts ? ` · ${t("fixed")}` : ""}
      </p>
    </div>
  );
}
