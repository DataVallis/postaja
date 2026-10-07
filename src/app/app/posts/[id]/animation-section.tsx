import { Clapperboard, Download } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AutoRefresh } from "@/app/app/plan/auto-refresh";
import { Badge, buttonClass, Card, selectClass, textareaClass } from "@/components/ui";
import { microToUsd } from "@/lib/money/usd";
import type { MediaStatus } from "@/server/db/schema";
import { requestAnimationAction } from "../actions";

const TONE: Record<MediaStatus, "neutral" | "signal" | "ok" | "danger"> = { none: "neutral", queued: "signal", rendering: "signal", ready: "ok", failed: "danger" };

/**
 * Animation of one post image (TASK-022): the clean illustration moves, Postaja burns the words and logo back on.
 * Shown when at least one image has a full-bleed illustration.
 */
export async function AnimationSection(props: {
  postId: string; status: MediaStatus; error: string | null; requestError?: string;
  positions: number[]; position: number | null; motion: string | null;
  video: { id: string; position: number; width: number; height: number } | null; maxCost: bigint | null;
}) {
  const t = await getTranslations("Animation");
  const ti = await getTranslations("Images");
  const working = props.status === "queued" || props.status === "rendering";
  const selected = props.position !== null && props.positions.includes(props.position) ? props.position : props.positions[0];
  const [code, ...rest] = (props.error ?? "FAILED").split(":");
  const errText = (c: string) => (t.has(`errors.${c}`) ? t(`errors.${c}`) : ti.has(`errors.${c}`) ? ti(`errors.${c}`) : t("errors.FAILED"));
  return (
    <Card className="grid gap-4 p-5" id="animation" data-testid="animation">
      <AutoRefresh active={working} seconds={4} />
      <h2 className="flex items-center gap-3 text-base font-semibold">
        {t("title")}
        <span data-testid="animation-status" className="text-sm font-normal"><Badge tone={TONE[props.status]} dot>{ti(`status.${props.status}`)}</Badge></span>
      </h2>
      <p className="max-w-2xl text-sm text-muted">{t("hint")}</p>
      {props.status === "failed" ? <p role="alert" className="rounded-lg border border-danger/50 p-3 text-sm">{errText(code)}{rest.length ? <span className="mt-1 block text-xs text-muted">{rest.join(":")}</span> : null}</p> : null}
      {props.requestError ? <p role="alert" className="text-sm text-danger">{errText(props.requestError)}</p> : null}
      {working ? <p className="text-sm text-muted" aria-live="polite">{t("working")}</p> : null}

      {props.video && !working ? (
        <div className="grid max-w-sm gap-2">
          <video src={`/api/post-media/${props.video.id}`} controls muted loop playsInline preload="metadata" width={props.video.width} height={props.video.height}
            className="h-auto w-full rounded-lg ring-1 ring-line" aria-label={t("videoLabel", { n: props.video.position + 1 })} data-testid="animation-video" />
          <a href={`/api/post-media/${props.video.id}?download=1`} className={buttonClass("ghost", "sm")} data-testid="animation-download"><Download aria-hidden className="size-4" />{t("download")}</a>
        </div>
      ) : null}

      <form key={`${props.status}-${props.video?.id ?? ""}`} action={requestAnimationAction} className="grid gap-3">
        <input type="hidden" name="postId" value={props.postId} />
        {props.positions.length > 1 ? (
          <div className="grid gap-1 sm:max-w-xs">
            <label htmlFor="anim-position" className="text-sm font-medium">{t("which")}</label>
            <select id="anim-position" name="position" defaultValue={String(selected)} className={selectClass}>
              {props.positions.map((p) => <option key={p} value={p}>{ti("imageAlt", { n: p + 1 })}</option>)}
            </select>
          </div>
        ) : <input type="hidden" name="position" value={selected} />}
        <div className="grid gap-1">
          <label htmlFor="anim-motion" className="text-sm font-medium">{t("motion")}</label>
          <textarea id="anim-motion" name="motion" rows={2} maxLength={600} defaultValue={props.motion ?? ""} placeholder={t("motionPlaceholder")} aria-describedby="anim-motion-hint" className={textareaClass} />
          <p id="anim-motion-hint" className="text-xs text-muted">{t("motionHint")}</p>
        </div>
        <div>
          <button type="submit" disabled={working} className={buttonClass(props.video ? "secondary" : "primary")}>
            <Clapperboard aria-hidden className="size-4" />
            {props.video ? t("again") : t("animate")}{props.maxCost !== null ? ` · ${t("atMost", { cost: `${microToUsd(props.maxCost)} €` })}` : ""}
          </button>
        </div>
      </form>
    </Card>
  );
}
