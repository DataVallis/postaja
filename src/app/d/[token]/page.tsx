import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { AutoRefresh } from "@/app/app/plan/auto-refresh";
import { Card } from "@/components/ui";
import { getDb } from "@/server/db/client";
import { DemoError, demoView } from "@/server/demos/service";

export const dynamic = "force-dynamic";
// A capability link: never indexed, never sent on as a Referer.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

const field = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(" / ") : (v ?? ""));

/** A prospect's demo (TASK-040): their brand as Postaja would run it — read only, no account, no app menu. */
export default async function DemoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("Demo");
  const f = await getFormatter();
  const view = await demoView(getDb(), token).catch((e) => { if (e instanceof DemoError) return null; throw e; });
  const mark = <p className="text-sm font-bold">postaja<span className="text-signal">.</span></p>;
  if (!view || view.status === "failed") {
    return (
      <main className="mx-auto grid min-h-screen max-w-xl content-center gap-3 p-6 text-center">
        <p className="text-2xl font-bold">postaja<span className="text-signal">.</span></p>
        <h1 className="text-lg font-semibold">{view ? t("failedTitle") : t("goneTitle")}</h1>
        <p className="text-sm text-muted">{view ? t("failedBody") : t("goneBody")}</p>
      </main>
    );
  }
  if (view.status !== "ready") {
    return (
      <main className="mx-auto grid min-h-screen max-w-xl content-center gap-3 p-6 text-center" data-testid="demo-pending">
        <AutoRefresh active seconds={10} />
        <p className="text-2xl font-bold">postaja<span className="text-signal">.</span></p>
        <h1 className="text-lg font-semibold">{t("pendingTitle")}</h1>
        <p className="text-sm text-muted">{t("pendingBody")}</p>
      </main>
    );
  }
  const day = (d: string | null) => (d ? f.dateTime(new Date(`${d}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long" }) : "");
  return (
    <main className="mx-auto grid max-w-3xl gap-8 px-4 py-8" data-testid="demo-view">
      <header className="grid gap-3">
        {mark}
        <div className="flex items-center gap-4">
          {view.logoId ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived presigned URL behind a token check
            <img src={`/d/${token}/m/${view.logoId}`} alt={t("logoAlt", { brand: view.brandName ?? "" })} className="h-14 w-auto max-w-40 rounded bg-white object-contain p-1 ring-1 ring-line" />
          ) : null}
          <h1 className="text-2xl font-bold">{t("title", { brand: view.brandName ?? "" })}</h1>
        </div>
        <p className="max-w-2xl text-sm">{t("intro", { url: view.url })}</p>
      </header>

      <section className="grid gap-4" aria-labelledby="demo-posts">
        <h2 id="demo-posts" className="text-lg font-semibold">{t("postsTitle")}</h2>
        {view.posts.map((p) => {
          const text = p.content?.parts?.length ? p.content.parts.join("\n\n—\n\n") : p.content?.caption;
          return (
            <Card key={p.id} className="grid gap-4 p-5" data-testid="demo-post">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-semibold">{day(p.scheduledOn)}</span>
                <span className="text-muted">{t(`formats.${p.format === "carousel" ? "carousel" : "image"}`)}</span>
              </div>
              {p.images.length ? (
                <div className="flex gap-2 overflow-x-auto" tabIndex={0} role="region" aria-label={t("imagesLabel", { topic: p.topic ?? "" })}>
                  {p.images.map((m) => (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived presigned URL behind a token check
                    <img key={m.id} src={`/d/${token}/m/${m.id}`} alt={t("imageAlt", { n: m.position + 1 })} width={m.width} height={m.height} loading="lazy" className="h-auto w-64 shrink-0 rounded-lg ring-1 ring-line" />
                  ))}
                </div>
              ) : null}
              {text ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p> : <p className="text-sm text-muted">{p.topic}</p>}
            </Card>
          );
        })}
      </section>

      {view.ad ? (
        <section className="grid gap-4" aria-labelledby="demo-ad" data-testid="demo-ad">
          <h2 id="demo-ad" className="text-lg font-semibold">{t("adTitle")}</h2>
          {view.ad.offer ? <p className="text-sm text-muted">{view.ad.offer}</p> : null}
          {view.ad.creatives.length ? (
            <div className="flex gap-2 overflow-x-auto" tabIndex={0} role="region" aria-label={t("creativesLabel")}>
              {view.ad.creatives.map((m) => (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived presigned URL behind a token check
                <img key={m.id} src={`/d/${token}/m/${m.id}`} alt={t("creativeAlt", { n: m.variant + 1 })} width={m.width} height={m.height} loading="lazy" className="h-auto w-56 shrink-0 rounded-lg ring-1 ring-line" />
              ))}
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-3">
            {view.ad.variants.map((v, i) => (
              <Card key={i} className="grid content-start gap-2 p-4 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("variant", { n: i + 1 })}</p>
                {v.headline ? <p className="font-semibold">{field(v.headline)}</p> : null}
                {v.primary_text ? <p className="whitespace-pre-wrap">{field(v.primary_text)}</p> : null}
                {v.description ? <p className="text-muted">{field(v.description)}</p> : null}
                {v.cta ? <p className="text-xs text-muted">{t("cta", { cta: field(v.cta) })}</p> : null}
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <footer className="grid gap-1 border-t border-line pt-4 text-xs text-muted">
        <p>{t("footer")}</p>
        <p>{t("aiNote")}</p>
        <p>{t("until", { until: f.dateTime(view.expiresAt, { dateStyle: "medium" }) })}</p>
      </footer>
    </main>
  );
}
