import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, buttonClass, Card, inputClass, textareaClass } from "@/components/ui";
import { getDb } from "@/server/db/client";
import { clientView, ReviewError } from "@/server/reviews/service";
import { submitReviewAction } from "../actions";

export const dynamic = "force-dynamic";
// A capability link: never indexed, never sent on as a Referer.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** The agency's client reviews the planned posts of one brand (TASK-041) — no account, no app menu. */
export default async function ClientReviewPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string; error?: string; post?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const t = await getTranslations("ClientReview");
  const f = await getFormatter();
  const view = await clientView(getDb(), token).catch((e) => { if (e instanceof ReviewError) return null; throw e; });
  if (!view) {
    return (
      <main className="mx-auto grid min-h-screen max-w-xl content-center gap-3 p-6 text-center">
        <p className="text-2xl font-bold">postaja<span className="text-signal">.</span></p>
        <h1 className="text-lg font-semibold">{t("goneTitle")}</h1>
        <p className="text-sm text-muted">{t("goneBody")}</p>
      </main>
    );
  }
  const day = (d: string) => f.dateTime(new Date(`${d}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long" });
  return (
    <main className="mx-auto grid max-w-3xl gap-6 px-4 py-8" data-testid="client-review">
      <header className="grid gap-1">
        <p className="text-sm font-bold">postaja<span className="text-signal">.</span></p>
        <h1 className="text-2xl font-bold">{t("title", { brand: view.link.brandName })}</h1>
        <p className="text-sm text-muted">{t("range", { from: day(view.link.from), to: day(view.link.to) })}</p>
        <p className="max-w-2xl text-sm">{t("intro")}</p>
      </header>
      {!view.posts.length ? <p className="text-sm text-muted">{t("none")}</p> : null}
      {view.posts.map((p) => {
        const text = p.content?.parts?.length ? p.content.parts.join("\n\n—\n\n") : p.content?.caption;
        return (
          <Card key={p.id} id={`p-${p.id}`} className="grid scroll-mt-6 gap-4 p-5" data-testid="client-post">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-semibold">{p.scheduledOn ? day(p.scheduledOn) : t("noDate")}{p.scheduledTime ? ` · ${p.scheduledTime}` : ""}</span>
              <span className="text-muted">{p.platform ? `${p.platform} · ${p.handle}` : ""}</span>
            </div>
            {p.images.length ? (
              <div className="flex gap-2 overflow-x-auto">
                {p.images.map((m) => (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived presigned URL behind a token check
                  <img key={m.id} src={`/r/${token}/m/${m.id}`} alt={t("imageAlt", { n: m.position + 1 })} width={m.width} height={m.height} loading="lazy" className="h-auto w-56 shrink-0 rounded-lg ring-1 ring-line" />
                ))}
              </div>
            ) : null}
            {p.videos.map((v) => <video key={v.id} src={`/r/${token}/m/${v.id}`} controls preload="metadata" className="w-56 rounded-lg ring-1 ring-line" aria-label={t("video")} />)}
            {text ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p> : <p className="text-sm text-muted">{t("notWritten", { topic: p.topic ?? p.brief })}</p>}
            {p.review ? (
              <p className="text-sm" data-testid="client-post-review">
                <Badge tone={p.review.decision === "approved" ? "ok" : "warn"} dot>{p.review.decision === "approved" ? t("approved") : t("changesAsked")}</Badge>
                {p.review.comment ? <span className="ml-2 text-muted">“{p.review.comment}”</span> : null}
              </p>
            ) : null}
            {sp.done === p.id ? <p role="status" className="text-sm text-ok">{t("thanks")}</p> : null}
            {sp.error && sp.post === p.id ? <p role="alert" className="text-sm text-danger">{t.has(`errors.${sp.error}`) ? t(`errors.${sp.error}`) : t("errors.FAILED")}</p> : null}
            {p.canReview ? (
              <form action={submitReviewAction} className="grid gap-2 border-t border-line pt-3">
                <input type="hidden" name="token" value={token} /><input type="hidden" name="postId" value={p.id} />
                <label className="grid gap-1 text-sm"><span>{t("comment")}</span><textarea name="comment" rows={2} maxLength={2000} className={textareaClass} /></label>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="grid gap-1 text-sm"><span>{t("reviewer")}</span><input name="reviewer" maxLength={80} className={`${inputClass} w-48`} /></label>
                  <button type="submit" name="decision" value="approved" className={buttonClass("primary")}>{t("approve")}</button>
                  <button type="submit" name="decision" value="changes" className={buttonClass("secondary")}>{t("askChanges")}</button>
                </div>
              </form>
            ) : null}
          </Card>
        );
      })}
      <footer className="text-xs text-muted">{t("footer", { until: f.dateTime(view.link.expiresAt, { dateStyle: "medium" }) })}</footer>
    </main>
  );
}
