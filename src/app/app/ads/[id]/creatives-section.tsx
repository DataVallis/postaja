import { Download, ImageIcon, RefreshCw } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AutoRefresh } from "@/app/app/plan/auto-refresh";
import { Badge, buttonClass, Card, inputClass, textareaClass } from "@/components/ui";
import { microToUsd } from "@/lib/money/usd";
import type { AdMediaStatus, AdVisual } from "@/server/db/schema";
import { requestAdImagesAction, saveAdSlidesAction } from "../actions";

type Media = { id: string; variant: number; placement: string; width: number; height: number };
type Placement = { key: string; label: string; width: number; height: number };
type TemplateInfo = { id: string; name: string; slots: string[] };

const TONE: Record<AdMediaStatus, "neutral" | "signal" | "ok" | "danger"> = { none: "neutral", queued: "signal", rendering: "signal", ready: "ok", failed: "danger" };
const LONG = new Set(["headline", "body", "subhead"]);

/** Creatives of an ad set (TASK-021b): per placement one image per copy variant, from the brand's design. */
export async function CreativesSection(props: {
  adSetId: string; status: AdMediaStatus; error: string | null; requestError?: string; media: Media[]; visual: AdVisual | null;
  templates: TemplateInfo[] | null; placements: Placement[]; variants: number; estimate: { illustrations: number; max: bigint } | null; designHref: string;
}) {
  const t = await getTranslations("Ads");
  const ti = await getTranslations("Images");
  const working = props.status === "queued" || props.status === "rendering";
  const version = props.media.map((m) => m.id).join(",");
  const [code, ...rest] = (props.error ?? "FAILED").split(":");
  const errText = (c: string) => (t.has(`imageErrors.${c}`) ? t(`imageErrors.${c}`) : ti.has(`errors.${c}`) ? ti(`errors.${c}`) : t("imageErrors.FAILED"));
  return (
    <Card className="grid gap-4 p-5" id="creatives" data-testid="creatives">
      <AutoRefresh active={working} seconds={3} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 text-base font-semibold">
          {t("creativesTitle")}
          <span data-testid="creatives-status" className="text-sm font-normal"><Badge tone={TONE[props.status]} dot>{ti(`status.${props.status}`)}</Badge></span>
        </h2>
        <Link href={props.designHref} className="text-sm text-muted underline underline-offset-4 hover:text-fg">{ti("designLink")}</Link>
      </div>
      {!props.templates ? <p className="text-sm" data-testid="no-design">{ti("noDesign")} <Link href={props.designHref} className="underline underline-offset-4">{ti("createDesign")}</Link></p> : null}
      {props.status === "failed" ? (
        <p role="alert" className="rounded-lg border border-danger/50 p-3 text-sm">{errText(code)}{rest.length ? <span className="mt-1 block text-xs text-muted">{rest.join(":")}</span> : null}</p>
      ) : null}
      {props.requestError ? <p role="alert" className="text-sm text-danger">{errText(props.requestError)}</p> : null}
      {working ? <p className="text-sm text-muted" aria-live="polite">{ti("working")}</p> : null}

      {props.media.length ? props.placements.map((p) => {
        const mine = props.media.filter((m) => m.placement === p.key);
        if (!mine.length) return null;
        return (
          <section key={p.key} className="grid gap-2" data-testid={`placement-${p.key}`}>
            <h3 className="text-sm font-medium">{p.label} <span className="text-muted">· {p.width}×{p.height}</span></h3>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {mine.map((m) => (
                <li key={m.id} className="grid min-w-0 content-start gap-2">
                  <a href={`/api/ad-media/${m.id}`} target="_blank" rel="noopener" className="block overflow-hidden rounded-lg bg-paper ring-1 ring-line focus-visible:outline-2 focus-visible:outline-fg">
                    {/* eslint-disable-next-line @next/next/no-img-element -- presigned S3 URL behind an access-checked redirect */}
                    <img src={`/api/ad-media/${m.id}`} alt={t("creativeAlt", { placement: p.label, n: m.variant + 1 })} width={m.width} height={m.height} className="h-auto w-full" />
                  </a>
                  <a href={`/api/ad-media/${m.id}?download=1`} className={buttonClass("ghost", "sm")}><Download aria-hidden className="size-4" />{t("variant", { n: m.variant + 1 })}</a>
                </li>
              ))}
            </ul>
          </section>
        );
      }) : props.templates && props.status === "none" ? <p className="text-sm text-muted">{t("creativesEmpty", { placements: props.placements.length, variants: props.variants })}</p> : null}

      {props.templates ? (
        <div className="flex flex-wrap items-center gap-3">
          <form action={requestAdImagesAction}>
            <input type="hidden" name="adSetId" value={props.adSetId} />
            <input type="hidden" name="mode" value="new" />
            <button type="submit" disabled={working} className={buttonClass(props.media.length ? "secondary" : "primary")}>
              <ImageIcon aria-hidden className="size-4" />{props.media.length ? t("newCreatives") : t("makeCreatives")}
            </button>
          </form>
          {props.media.length ? <a href={`/api/ads/${props.adSetId}/zip`} className={buttonClass("secondary")} data-testid="ad-zip"><Download aria-hidden className="size-4" />{t("zip")}</a> : null}
          {props.estimate ? <span className="text-xs text-muted" data-testid="creatives-estimate">{t("creativesEstimate", { illustrations: props.estimate.illustrations, max: `${microToUsd(props.estimate.max)} €` })}</span> : null}
        </div>
      ) : null}

      {props.visual && props.templates && props.media.length ? (
        <form key={`texts-${version}`} action={saveAdSlidesAction} className="grid gap-4 border-t border-line pt-4" data-testid="creative-texts">
          <input type="hidden" name="adSetId" value={props.adSetId} />
          <div>
            <h3 className="text-sm font-semibold">{ti("textsTitle")}</h3>
            <p className="text-xs text-muted">{t("creativeTextsHint")}</p>
          </div>
          {props.visual.variants.map((v, i) => {
            const tpl = props.templates!.find((x) => x.id === v.templateId);
            return (
              <fieldset key={i} className="grid gap-2 rounded-lg border border-line p-3">
                <legend className="px-1 text-xs font-medium text-muted">{t("variant", { n: i + 1 })} · {tpl?.name ?? v.templateId}</legend>
                {(tpl?.slots ?? Object.keys(v.slots)).map((slot) => {
                  const id = `ad-slide-${i}-${slot}`;
                  return (
                    <div key={slot} className="grid gap-1">
                      <label htmlFor={id} className="text-xs font-medium">{ti(`slots.${slot as "headline"}`)} · {i + 1}</label>
                      {LONG.has(slot)
                        ? <textarea id={id} name={`s${i}.${slot}`} rows={2} maxLength={300} defaultValue={v.slots[slot] ?? ""} className={textareaClass} />
                        : <input id={id} name={`s${i}.${slot}`} maxLength={300} defaultValue={v.slots[slot] ?? ""} className={inputClass} />}
                    </div>
                  );
                })}
              </fieldset>
            );
          })}
          <div><button type="submit" disabled={working} className={buttonClass("secondary")}><RefreshCw aria-hidden className="size-4" />{ti("saveAndRefresh")}</button></div>
        </form>
      ) : null}
    </Card>
  );
}
