import { Download } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge, buttonClass, Card, inputClass, PageHeader, selectClass, textareaClass } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { graphemeLength } from "@/lib/rules";
import { textsOf } from "@/server/ads/check";
import { AdError, adNetworkInfo, getAdSet } from "@/server/ads/service";
import { requireOrgPage } from "@/server/auth/require";
import { getBrandDetail } from "@/server/brands/service";
import { getDb } from "@/server/db/client";
import type { AdCopyIssue } from "@/server/db/schema";
import { rewriteAdCopyAction, saveAdCopyAction } from "../actions";
import { CreativesSection } from "./creatives-section";
import { adImageEstimate, listAdMedia } from "@/server/ads/creatives";
import { currentDesign } from "@/server/design/service";
import { templateSlots } from "@/server/design/spec";

export const dynamic = "force-dynamic";

const TONE = { draft: "neutral", ready: "ok", needs_review: "warn" } as const;

/** One ad set (TASK-021): the copy variants per network, checked against the network's limits; edit, rewrite, export. */
export default async function AdSetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string; imageError?: string }> }) {
  const { org } = await requireOrgPage();
  const { id } = await params;
  const { error, saved, imageError } = await searchParams;
  const db = getDb();
  const a = await getAdSet(db, org, id).catch((e) => {
    if (e instanceof AdError) notFound();
    throw e;
  });
  const { brand } = await getBrandDetail(db, org, a.brandId);
  const networks = await adNetworkInfo(db, a.networks);
  const t = await getTranslations("Ads");
  const issuesOf = (variant: number, network: string, field: string, index?: number) =>
    a.issues.filter((x) => x.variant === variant && x.network === network && x.field === field && (index === undefined || x.index === undefined || x.index === index));
  const issueText = (x: AdCopyIssue) => t(`issues.${x.code}`, { actual: String(x.actual), limit: String(x.limit) });
  const hard = a.issues.filter((x) => x.code !== "long_visible");
  const [errCode, ...errRest] = (a.error ?? "").split(":");
  const [media, design, estimate] = await Promise.all([listAdMedia(db, org, a.id), currentDesign(db, org, a.brandId), a.copy.length ? adImageEstimate(db, org, a) : Promise.resolve(null)]);
  const templates = design?.spec ? design.spec.templates.map((x) => ({ id: x.id, name: x.name, slots: templateSlots(x) })) : null;
  const placements = networks.flatMap((n) => n.placements.filter((p) => a.placements.includes(p.key)).map((p) => ({ ...p, network: n.label })));

  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/app/brands/${brand.id}?tab=ads`} className="hover:text-fg hover:underline">{brand.name} · {t("title")}</Link>}
        title={a.name}
        description={[t(`objectives.${a.objective}`), a.landingUrl, a.offer].filter(Boolean).join(" · ")}
        actions={<span data-testid="ad-status"><Badge tone={TONE[a.status]} dot>{t(`status.${a.status}`)}</Badge></span>}
      />
      <div className="grid gap-6" data-testid="ad-set">
        {error ? <p role="alert" className="text-sm text-danger">{t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.FAILED")}</p> : null}
        {a.error ? (
          <p role="alert" className="rounded-lg border border-danger/50 p-3 text-sm" data-testid="ad-error">
            {t.has(`errors.${errCode}`) ? t(`errors.${errCode}`) : t("errors.FAILED")}
            {errRest.length ? <span className="mt-1 block text-xs text-muted">{errRest.join(":")}</span> : null}
          </p>
        ) : null}
        {saved ? <p role="status" className="text-sm text-ok">{t("saved")}</p> : null}
        {a.copy.length && hard.length ? <p role="alert" className="text-sm text-warn" data-testid="ad-issues">{t("issuesSummary", { n: hard.length })}</p> : null}

        {a.copy.length ? (
          <CreativesSection
            adSetId={a.id} status={a.mediaStatus} error={a.mediaError} requestError={imageError} media={media} visual={a.visual}
            templates={templates} variants={a.copy.length} estimate={estimate} designHref={`/app/brands/${brand.id}?tab=design`}
            placements={placements.map((p) => ({ key: p.key, label: `${p.network} · ${t(`placements.${p.placement}`)}`, width: p.width, height: p.height }))}
          />
        ) : null}

        <Card className="grid gap-2 p-4 text-sm">
          <p className="font-medium">{t("placementsTitle")}</p>
          <p className="text-muted" data-testid="ad-placements">{networks.map((n) => {
            const mine = placements.filter((p) => p.network === n.label);
            return mine.length ? `${n.label}: ${mine.map((p) => `${t(`placements.${p.placement}`)} ${p.width}×${p.height}`).join(", ")}` : null;
          }).filter(Boolean).join(" · ")}</p>
        </Card>

        {a.copy.length ? (
          <form action={saveAdCopyAction} className="grid gap-6" data-testid="ad-copy">
            <input type="hidden" name="adSetId" value={a.id} />
            {networks.flatMap((n) => n.fields.filter((fl) => fl.max > 1).map((fl) => <input key={`${n.key}.${fl.key}`} type="hidden" name={`multi.${fl.key}`} value="1" />))}
            {a.copy.map((v, vi) => (
              <Card key={vi} className="grid gap-4 p-5" data-testid={`variant-${vi + 1}`}>
                <h2 className="text-base font-semibold">{t("variant", { n: vi + 1 })}</h2>
                {networks.map((n) => {
                  const c = v[n.key] ?? {};
                  return (
                    <fieldset key={n.key} className="grid gap-3 rounded-lg border border-line p-3">
                      <legend className="px-1 text-xs font-medium text-muted">{n.label}</legend>
                      {n.fields.map((fl) => {
                        const fid = `v${vi}-${n.key}-${fl.key}`;
                        const texts = textsOf(c[fl.key]);
                        const own = issuesOf(vi, n.key, fl.key);
                        const longest = Math.max(0, ...texts.map((x) => graphemeLength(x)));
                        return (
                          <div key={fl.key} className="grid gap-1">
                            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                              <label htmlFor={fid} className="font-medium">{t.has(`fields.${fl.key}`) ? t(`fields.${fl.key}`) : fl.label}</label>
                              <span id={`${fid}-n`} className={`tabular-nums ${longest > fl.maxChars ? "text-danger" : "text-muted"}`}>
                                {fl.max > 1 ? `${t("perLine", { max: fl.max })} · ` : ""}{longest} / {fl.maxChars}{fl.recommended ? ` (${t("visible", { n: fl.recommended })})` : ""}
                              </span>
                            </div>
                            {fl.max > 1 || fl.maxChars > 120
                              ? <textarea id={fid} name={`v${vi}.${n.key}.${fl.key}`} rows={fl.max > 1 ? Math.max(2, texts.length) : 3} defaultValue={texts.join("\n")} aria-describedby={`${fid}-n`} aria-invalid={own.some((x) => x.code !== "long_visible") || undefined} className={textareaClass} />
                              : <input id={fid} name={`v${vi}.${n.key}.${fl.key}`} defaultValue={texts[0] ?? ""} aria-describedby={`${fid}-n`} aria-invalid={own.some((x) => x.code !== "long_visible") || undefined} className={inputClass} />}
                            {own.map((x, k) => <p key={k} className={`text-xs ${x.code === "long_visible" ? "text-muted" : "text-danger"}`}>{x.index !== undefined ? `${x.index + 1}: ` : ""}{issueText(x)}</p>)}
                          </div>
                        );
                      })}
                      {n.ctas.length ? (
                        <div className="grid gap-1 sm:max-w-xs">
                          <label htmlFor={`v${vi}-${n.key}-cta`} className="text-xs font-medium">{t("cta")}</label>
                          <select id={`v${vi}-${n.key}-cta`} name={`v${vi}.${n.key}.cta`} defaultValue={typeof c.cta === "string" ? c.cta : ""} className={selectClass}>
                            <option value="">—</option>
                            {n.ctas.map((x) => <option key={x} value={x}>{x}</option>)}
                          </select>
                          {issuesOf(vi, n.key, "cta").map((x, k) => <p key={k} className="text-xs text-danger">{issueText(x)}</p>)}
                        </div>
                      ) : null}
                    </fieldset>
                  );
                })}
              </Card>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className={buttonClass("primary")}>{t("save")}</button>
              <a href={`/api/ads/${a.id}/copy`} className={buttonClass("secondary")} data-testid="ad-csv"><Download aria-hidden className="size-4" />{t("csv")}</a>
            </div>
          </form>
        ) : null}

        <form action={rewriteAdCopyAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="adSetId" value={a.id} />
          <SubmitButton variant={a.copy.length ? "secondary" : "primary"} pending={t("writing")}>{a.copy.length ? t("rewrite") : t("retry")}</SubmitButton>
          <span className="text-xs text-muted">{t("rewriteHint")}</span>
        </form>
      </div>
    </>
  );
}
