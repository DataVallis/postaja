import { Film } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AutoRefresh } from "@/app/app/plan/auto-refresh";
import { Badge, buttonClass, Card, selectClass, textareaClass } from "@/components/ui";
import { microToUsd } from "@/lib/money/usd";
import type { MediaStatus } from "@/server/db/schema";
import { requestReelAction } from "../actions";
import { VideoList, type VideoItem } from "./video-list";

const TONE: Record<MediaStatus, "neutral" | "signal" | "ok" | "danger"> = { none: "neutral", queued: "signal", rendering: "signal", ready: "ok", failed: "danger" };

/**
 * Reel from several shots (TASK-058): Claude splits the post into 2–4 shots; scenes move with Kling 3.0 from first frames
 * checked for made-up writing; screens are the brand's own reference pictures; Postaja sets the captions and the
 * closing card in the brand's fonts.
 */
export async function ReelSection(props: {
  postId: string; status: MediaStatus; error: string | null; requestError?: string; wish: string | null; durationS: number | null;
  costs: { durationS: number; maxCost: bigint | null }[]; videos: VideoItem[]; referenceCount: number; primary: boolean;
}) {
  const t = await getTranslations("Reel");
  const ti = await getTranslations("Images");
  const working = props.status === "queued" || props.status === "rendering";
  const [code, ...rest] = (props.error ?? "FAILED").split(":");
  // REEL_*_BLOCKED:<shots> · <provider's reason>
  const [shots, ...why] = rest.join(":").split(" · ");
  const reason = code.startsWith("REEL_") ? why.join(" · ") : rest.join(":");
  const errText = (c: string) => (t.has(`errors.${c}`) ? t(`errors.${c}`) : ti.has(`errors.${c}`) ? ti(`errors.${c}`) : t("errors.FAILED"));
  const euro = (v: bigint | null) => (v === null ? "" : ` · ${t("atMost", { cost: `${microToUsd(v)} €` })}`);
  return (
    <Card className="grid gap-4 p-5" id="reel" data-testid="reel">
      <AutoRefresh active={working} seconds={5} />
      <h2 className="flex items-center gap-3 text-base font-semibold">
        {t("title")}
        <span data-testid="reel-status" className="text-sm font-normal"><Badge tone={TONE[props.status]} dot>{t(`status.${props.status}`)}</Badge></span>
      </h2>
      <p className="max-w-2xl text-sm text-muted">{t("hint")}</p>
      <p className="max-w-2xl text-xs text-muted">{props.referenceCount ? t("references", { n: props.referenceCount }) : t("noReferences")}</p>
      {props.status === "failed" ? (
        <p role="alert" className="rounded-lg border border-danger/50 p-3 text-sm" data-testid="reel-error">
          {code === "REEL_FRAME_BLOCKED" || code === "REEL_VIDEO_BLOCKED" ? t(`errors.${code}`, { shots: shots ?? "?" }) : errText(code)}
          {reason ? <span className="mt-1 block text-xs text-muted">{code.startsWith("REEL_") ? t("reason", { reason }) : reason}</span> : null}
        </p>
      ) : null}
      {props.requestError ? <p role="alert" className="text-sm text-danger">{errText(props.requestError)}</p> : null}
      {working ? <p className="text-sm text-muted" aria-live="polite">{t("working")}</p> : null}

      <VideoList postId={props.postId} anchor="reel" videos={props.videos} testId="reel-videos" />

      <form key={`${props.status}-${props.videos[0]?.id ?? ""}`} action={requestReelAction} className="grid gap-3">
        <input type="hidden" name="postId" value={props.postId} />
        <div className="grid gap-1 sm:max-w-xs">
          <label htmlFor="reel-duration" className="text-sm font-medium">{t("duration")}</label>
          <select id="reel-duration" name="durationS" defaultValue={String(props.durationS ?? 12)} className={selectClass}>
            {props.costs.map((c) => <option key={c.durationS} value={c.durationS}>{t("seconds", { n: c.durationS })}{euro(c.maxCost)}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="reel-wish" className="text-sm font-medium">{t("wish")}</label>
          <textarea id="reel-wish" name="wish" rows={3} maxLength={800} defaultValue={props.wish ?? ""} placeholder={t("wishPlaceholder")} aria-describedby="reel-wish-hint" className={textareaClass} />
          <p id="reel-wish-hint" className="text-xs text-muted">{t("wishHint")}</p>
        </div>
        <div>
          <button type="submit" disabled={working} className={buttonClass(props.primary && !props.videos.length ? "primary" : "secondary")}>
            <Film aria-hidden className="size-4" />{props.videos.length ? t("again") : t("create")}
          </button>
        </div>
      </form>
    </Card>
  );
}
