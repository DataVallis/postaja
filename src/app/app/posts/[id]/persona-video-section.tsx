import { Clapperboard } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AutoRefresh } from "@/app/app/plan/auto-refresh";
import { Badge, buttonClass, Card, selectClass, textareaClass } from "@/components/ui";
import { microToUsd } from "@/lib/money/usd";
import type { MediaStatus } from "@/server/db/schema";
import { requestPersonaVideoAction } from "../actions";
import { VideoList, type VideoItem } from "./video-list";

const TONE: Record<MediaStatus, "neutral" | "signal" | "ok" | "danger"> = { none: "neutral", queued: "signal", rendering: "signal", ready: "ok", failed: "danger" };

/**
 * Video with the brand's persona (TASK-025): Claude writes the shot, the first frame is made from the passport
 * pictures (same person), Kling 3.0 animates it. Shown on posts of brands that have a persona with pictures.
 */
export async function PersonaVideoSection(props: {
  postId: string; personaName: string; brandId: string; status: MediaStatus; error: string | null; requestError?: string;
  wish: string | null; durationS: number | null; costs: { durationS: number; maxCost: bigint | null }[];
  videos: VideoItem[];
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

      <VideoList postId={props.postId} anchor="persona-video" videos={props.videos} testId="persona-videos" />

      <form key={`${props.status}-${props.videos[0]?.id ?? ""}`} action={requestPersonaVideoAction} className="grid gap-3">
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
          <button type="submit" disabled={working} className={buttonClass(props.videos.length ? "secondary" : "primary")}>
            <Clapperboard aria-hidden className="size-4" />{props.videos.length ? t("again") : t("create")}
          </button>
        </div>
      </form>
    </Card>
  );
}
