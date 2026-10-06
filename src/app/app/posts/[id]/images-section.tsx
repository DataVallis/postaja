import { Download, ImageIcon, RefreshCw, Type } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AutoRefresh } from "@/app/app/plan/auto-refresh";
import { Badge, buttonClass, Card, textareaClass } from "@/components/ui";
import type { MediaStatus } from "@/server/db/schema";
import { requestImagesAction, saveImageTextAction } from "../actions";

type Media = { id: string; position: number; width: number; height: number };

const TONE: Record<MediaStatus, "neutral" | "signal" | "ok" | "danger"> = { none: "neutral", queued: "signal", rendering: "signal", ready: "ok", failed: "danger" };

/** Post images (TASK-015): status, previews with download, (re)generate, and the text that goes on them. */
export async function ImagesSection(props: {
  postId: string;
  status: MediaStatus;
  error: string | null;
  media: Media[];
  imageText: string;
  carousel: boolean;
  canRefreshText: boolean;
  aiBackground: boolean;
  aiConfigured: boolean;
  requestError?: string;
  brandHref: string;
}) {
  const t = await getTranslations("Images");
  const working = props.status === "queued" || props.status === "rendering";
  return (
    <Card className="grid gap-4 p-5" id="images" data-testid="images">
      <AutoRefresh active={working} seconds={3} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 text-base font-semibold">
          {t("title")}
          <span data-testid="images-status" className="text-sm font-normal"><Badge tone={TONE[props.status]} dot>{t(`status.${props.status}`)}</Badge></span>
        </h2>
        <a href={`${props.brandHref}?tab=images`} className="text-sm text-muted underline underline-offset-4 hover:text-fg">{t("templateLink")}</a>
      </div>

      {props.status === "failed" ? <p role="alert" className="rounded-lg border border-danger/50 p-3 text-sm">{t(`errors.${props.error ?? "FAILED"}`)}</p> : null}
      {props.requestError ? <p role="alert" className="text-sm text-danger">{t(`errors.${props.requestError}`)}</p> : null}
      {props.aiBackground && !props.aiConfigured ? <p className="text-sm text-muted">{t("noKey")}</p> : null}
      {working ? <p className="text-sm text-muted" aria-live="polite">{t("working")}</p> : null}

      {props.media.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="image-list">
          {props.media.map((m) => (
            <li key={m.id} className="grid min-w-0 gap-2">
              <a href={`/api/post-media/${m.id}`} target="_blank" rel="noopener" className="block overflow-hidden rounded-lg bg-paper ring-1 ring-line focus-visible:outline-2 focus-visible:outline-fg">
                {/* eslint-disable-next-line @next/next/no-img-element -- presigned S3 URL behind an access-checked redirect */}
                <img src={`/api/post-media/${m.id}`} alt={t("imageAlt", { n: m.position + 1 })} width={m.width} height={m.height} className="h-auto w-full" />
              </a>
              <a href={`/api/post-media/${m.id}?download=1`} className={buttonClass("ghost", "sm")} data-testid="image-download">
                <Download aria-hidden className="size-4" />{t("download", { n: m.position + 1 })}
              </a>
            </li>
          ))}
        </ul>
      ) : props.status === "none" ? <p className="text-sm text-muted">{t("empty")}</p> : null}

      <div className="flex flex-wrap gap-2">
        <form action={requestImagesAction}>
          <input type="hidden" name="postId" value={props.postId} />
          <input type="hidden" name="mode" value="new" />
          <button type="submit" disabled={working} className={buttonClass(props.media.length ? "secondary" : "primary")}>
            <ImageIcon aria-hidden className="size-4" />{props.media.length ? t("regenerate") : t("generate")}
          </button>
        </form>
        {props.canRefreshText ? (
          <form action={requestImagesAction}>
            <input type="hidden" name="postId" value={props.postId} />
            <input type="hidden" name="mode" value="text" />
            <button type="submit" disabled={working} className={buttonClass("secondary")}><RefreshCw aria-hidden className="size-4" />{t("refreshText")}</button>
          </form>
        ) : null}
      </div>

      <form action={saveImageTextAction} className="grid gap-2 border-t border-line pt-4">
        <input type="hidden" name="postId" value={props.postId} />
        <label htmlFor="image-text" className="flex items-center gap-2 text-sm font-medium"><Type aria-hidden className="size-4" />{t("textLabel")}</label>
        <p id="image-text-hint" className="text-xs text-muted">{props.carousel ? t("textHintCarousel") : t("textHint")}</p>
        <textarea id="image-text" name="imageText" rows={props.carousel ? 6 : 3} defaultValue={props.imageText} aria-describedby="image-text-hint" className={textareaClass} />
        <div><button type="submit" className={buttonClass("secondary", "sm")}>{t("textSave")}</button></div>
      </form>
    </Card>
  );
}
