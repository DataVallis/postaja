import { Clapperboard, Download } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AutoRefresh } from "@/app/app/plan/auto-refresh";
import { Badge, buttonClass, Card, selectClass, textareaClass } from "@/components/ui";
import { microToUsd } from "@/lib/money/usd";
import type { MediaStatus } from "@/server/db/schema";
import type { Scene } from "@/server/personas/scene";
import { requestPersonaVideoAction } from "../actions";

const TONE: Record<MediaStatus, "neutral" | "signal" | "ok" | "danger"> = { none: "neutral", queued: "signal", rendering: "signal", ready: "ok", failed: "danger" };

/**
 * Video with the brand's persona (TASK-025): Claude writes the shot, the first frame is made from the passport
 * pictures (same person), Kling 3.0 animates it. Shown on posts of brands that have a persona with pictures.
 */
export async function PersonaVideoSection(props: {
  postId: string; personaName: string; brandId: string; status: MediaStatus; error: string | null; requestError?: string;
  wish: string | null; durationS: number | null; costs: { durationS: number; maxCost: bigint | null }[];
  video: { id: string; width: number; height: number } | null; keyframeId: string | null; scene: Scene | null;
}) {
  const t = await getTranslations("PersonaVideo");
  const ti = await getTranslations("Images");
  const working = props.status === "queued" || props.status === "rendering";
  const [code, ...rest] = (props.error ?? "FAILED").split(":");
  const errText = (c: string) => (t.has(`errors.${c}`) ? t(`errors.${c}`) : ti.has(`errors.${c}`) ? ti(`errors.${c}`) : t("errors.FAILED"));
  const euro = (v: bigint | null) => (v === null ? "" : ` · ${t("atMost", { cost: `${microToUsd(v)} €` })}`);
  return (
    <Card className="grid gap-4 p-5" id="persona-video" data-testid="persona-video">
      <AutoRefresh active={working} seconds={5} />
      <h2 className="flex items-center gap-3 text-base font-semibold">
        {t("title", { name: props.personaName })}
        <span data-testid="persona-video-status" className="text-sm font-normal"><Badge tone={TONE[props.status]} dot>{t(`status.${props.status}`)}</Badge></span>
      </h2>
      <p className="max-w-2xl text-sm text-muted">{t("hint")}</p>
      {props.status === "failed" ? <p role="alert" className="rounded-lg border border-danger/50 p-3 text-sm">{errText(code)}{rest.length ? <span className="mt-1 block text-xs text-muted">{rest.join(":")}</span> : null}</p> : null}
      {props.requestError ? <p role="alert" className="text-sm text-danger">{errText(props.requestError)}</p> : null}
      {working ? <p className="text-sm text-muted" aria-live="polite">{t("working")}</p> : null}

      {props.video && !working ? (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,18rem)_1fr]">
          <div className="grid content-start gap-2">
            <video src={`/api/post-media/${props.video.id}`} poster={props.keyframeId ? `/api/post-media/${props.keyframeId}` : undefined} controls muted loop playsInline preload="metadata"
              width={props.video.width} height={props.video.height} className="h-auto w-full rounded-lg ring-1 ring-line" aria-label={t("videoLabel", { name: props.personaName })} data-testid="persona-video-player" />
            <a href={`/api/post-media/${props.video.id}?download=1`} className={buttonClass("ghost", "sm")} data-testid="persona-video-download"><Download aria-hidden className="size-4" />{t("download")}</a>
          </div>
          {props.scene ? (
            <dl className="grid content-start gap-2 text-sm" data-testid="persona-video-scene">
              <dt className="font-medium">{t("sceneFrame")}</dt><dd className="text-muted">{props.scene.keyframe}</dd>
              <dt className="font-medium">{t("sceneMotion")}</dt><dd className="text-muted">{props.scene.motion}</dd>
            </dl>
          ) : null}
        </div>
      ) : null}

      <form key={`${props.status}-${props.video?.id ?? ""}`} action={requestPersonaVideoAction} className="grid gap-3">
        <input type="hidden" name="postId" value={props.postId} />
        <div className="grid gap-1 sm:max-w-xs">
          <label htmlFor="pv-duration" className="text-sm font-medium">{t("duration")}</label>
          <select id="pv-duration" name="durationS" defaultValue={String(props.durationS ?? 5)} className={selectClass}>
            {props.costs.map((c) => <option key={c.durationS} value={c.durationS}>{t("seconds", { n: c.durationS })}{euro(c.maxCost)}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="pv-wish" className="text-sm font-medium">{t("wish")}</label>
          <textarea id="pv-wish" name="wish" rows={2} maxLength={600} defaultValue={props.wish ?? ""} placeholder={t("wishPlaceholder")} aria-describedby="pv-wish-hint" className={textareaClass} />
          <p id="pv-wish-hint" className="text-xs text-muted">{t("wishHint")}</p>
        </div>
        <div>
          <button type="submit" disabled={working} className={buttonClass(props.video ? "secondary" : "primary")}>
            <Clapperboard aria-hidden className="size-4" />{props.video ? t("again") : t("create")}
          </button>
        </div>
      </form>
    </Card>
  );
}
