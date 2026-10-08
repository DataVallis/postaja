import { Download, Trash2 } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/ui";
import { deletePostVideoAction } from "../actions";

export type VideoItem = { id: string; width: number; height: number; createdAt: Date; label: string; poster: boolean; details?: { term: string; text: string }[] };

/**
 * A post's videos of one kind, newest first (TASK-032): every video stays until it is deleted here. Deleting asks once
 * more (a <details> step) because a video cannot be made again for free.
 */
export async function VideoList({ postId, anchor, videos, testId }: { postId: string; anchor: "animation" | "persona-video"; videos: VideoItem[]; testId: string }) {
  const t = await getTranslations("Videos");
  const f = await getFormatter();
  if (!videos.length) return null;
  return (
    <ul className="grid gap-5" data-testid={testId}>
      {videos.map((v) => (
        <li key={v.id} className="grid gap-3 sm:grid-cols-[minmax(0,18rem)_1fr]" data-testid={`${testId}-item`}>
          <div className="grid content-start gap-2">
            <video src={`/api/post-videos/${v.id}`} poster={v.poster ? `/api/post-videos/${v.id}?poster=1` : undefined} controls muted loop playsInline preload="metadata"
              width={v.width} height={v.height} className="h-auto w-full rounded-lg ring-1 ring-line" aria-label={v.label} />
          </div>
          <div className="grid content-start gap-2 text-sm">
            <p className="font-medium">{v.label}</p>
            <p className="text-xs text-muted">{t("made", { when: f.dateTime(v.createdAt, { dateStyle: "medium", timeStyle: "short" }) })}</p>
            {v.details?.length ? (
              <dl className="grid gap-1">
                {v.details.map((d) => [<dt key={`t-${d.term}`} className="font-medium">{d.term}</dt>, <dd key={`d-${d.term}`} className="text-muted">{d.text}</dd>])}
              </dl>
            ) : null}
            <div className="flex flex-wrap items-start gap-2">
              <a href={`/api/post-videos/${v.id}?download=1`} className={buttonClass("ghost", "sm")} data-testid={`${testId}-download`}><Download aria-hidden className="size-4" />{t("download")}</a>
              <details className="text-sm">
                <summary className={`${buttonClass("ghost", "sm")} cursor-pointer list-none`}><Trash2 aria-hidden className="size-4" />{t("delete")}</summary>
                <form action={deletePostVideoAction} className="mt-2 grid gap-2">
                  <input type="hidden" name="postId" value={postId} /><input type="hidden" name="videoId" value={v.id} /><input type="hidden" name="anchor" value={anchor} />
                  <p className="max-w-xs text-xs text-muted">{t("deleteWarning")}</p>
                  <button type="submit" className={buttonClass("secondary", "sm")}>{t("deleteConfirm")}</button>
                </form>
              </details>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
