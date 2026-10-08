import Link from "next/link";
import { Download, FileText, ImageIcon, RefreshCw, Wand2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AutoRefresh } from "@/app/app/plan/auto-refresh";
import { Badge, buttonClass, Card, inputClass, textareaClass } from "@/components/ui";
import type { MediaStatus, PostVisual } from "@/server/db/schema";
import { requestImagesAction, reviseImagesAction, saveSlidesAction } from "../actions";

type Media = { id: string; position: number; width: number; height: number };
type TemplateInfo = { id: string; name: string; slots: string[] };

const TONE: Record<MediaStatus, "neutral" | "signal" | "ok" | "danger"> = { none: "neutral", queued: "signal", rendering: "signal", ready: "ok", failed: "danger" };
const LONG = new Set(["headline", "body", "subhead"]);

/**
 * Post images (TASK-015/017): made from the brand's design — Claude picks the template and words per image, the
 * owner can correct the words and re-render them for free.
 */
export async function ImagesSection(props: {
  postId: string;
  status: MediaStatus;
  error: string | null;
  media: Media[];
  visual: PostVisual | null;
  templates: TemplateInfo[] | null;
  aiConfigured: boolean;
  requestError?: string;
  /** TASK-027/031: the brand's persona (with pictures) and whether this post's next images show it. */
  persona?: { name: string; checked: boolean } | null;
  designHref: string;
  /** LinkedIn carousel: offer the images as one PDF (a document post). */
  pdf?: boolean;
}) {
  const t = await getTranslations("Images");
  const working = props.status === "queued" || props.status === "rendering";
  // New images → the forms mount again, so their fields show the words now on the images (uncontrolled fields keep old
  // values across a refresh otherwise).
  const version = props.media.map((m) => m.id).join(",");
  return (
    <Card className="grid gap-4 p-5" id="images" data-testid="images">
      <AutoRefresh active={working} seconds={3} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 text-base font-semibold">
          {t("title")}
          <span data-testid="images-status" className="text-sm font-normal"><Badge tone={TONE[props.status]} dot>{t(`status.${props.status}`)}</Badge></span>
        </h2>
        <Link href={props.designHref} className="text-sm text-muted underline underline-offset-4 hover:text-fg">{t("designLink")}</Link>
      </div>

      {!props.templates ? (
        <p className="text-sm" data-testid="no-design">{t("noDesign")} <Link href={props.designHref} className="underline underline-offset-4">{t("createDesign")}</Link></p>
      ) : null}
      {props.status === "failed" ? (() => {
        const [code, ...rest] = (props.error ?? "FAILED").split(":");
        return (
          <p role="alert" className="rounded-lg border border-danger/50 p-3 text-sm">
            {t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.FAILED")}
            {rest.length ? <span className="mt-1 block text-xs text-muted">{rest.join(":")}</span> : null}
          </p>
        );
      })() : null}
      {props.requestError ? <p role="alert" className="text-sm text-danger">{t(`errors.${props.requestError}`)}</p> : null}
      {props.templates && !props.aiConfigured ? <p className="text-sm text-muted">{t("noKey")}</p> : null}
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
      ) : props.status === "none" && props.templates ? <p className="text-sm text-muted">{t("empty")}</p> : null}
      {props.pdf && props.status === "ready" ? (
        <div className="flex flex-wrap items-center gap-3">
          <a href={`/api/posts/${props.postId}/pdf`} className={buttonClass("secondary", "sm")} data-testid="carousel-pdf"><FileText aria-hidden className="size-4" />{t("pdf")}</a>
          <span className="text-xs text-muted">{t("pdfHint")}</span>
        </div>
      ) : null}

      {props.templates ? (
        <form key={`new-${version}-${props.persona?.checked ? 1 : 0}`} action={requestImagesAction} className="flex flex-wrap items-center gap-4">
          <input type="hidden" name="postId" value={props.postId} />
          <input type="hidden" name="mode" value="new" />
          <button type="submit" disabled={working} className={buttonClass(props.media.length ? "secondary" : "primary")}>
            <ImageIcon aria-hidden className="size-4" />{props.media.length ? t("regenerate") : t("generate")}
          </button>
          {props.persona ? (
            <label className="flex items-center gap-2 text-sm" data-testid="images-persona">
              <input type="hidden" name="personaChoice" value="1" />
              <input type="checkbox" name="withPersona" value="1" defaultChecked={props.persona.checked} className="size-4 accent-signal" />
              {t("withPersona", { name: props.persona.name })}
            </label>
          ) : null}
        </form>
      ) : null}

      {props.visual && props.templates && props.media.length ? (
        <form key={`revise-${version}`} action={reviseImagesAction} className="grid gap-2 border-t border-line pt-4" data-testid="image-revise">
          <input type="hidden" name="postId" value={props.postId} />
          <label htmlFor="image-instruction" className="text-sm font-semibold">{t("reviseLabel")}</label>
          <p id="image-instruction-hint" className="text-xs text-muted">{t("reviseHint")}</p>
          <textarea id="image-instruction" name="instruction" rows={3} required maxLength={1000} aria-describedby="image-instruction-hint" placeholder={t("revisePlaceholder")} className={textareaClass} />
          {props.visual.revision ? <p className="text-xs text-muted" data-testid="image-revision">{t("lastRevision", { text: props.visual.revision })}</p> : null}
          <div><button type="submit" disabled={working} className={buttonClass("secondary")}><Wand2 aria-hidden className="size-4" />{t("revise")}</button></div>
        </form>
      ) : null}

      {props.visual && props.templates ? (
        <form key={`texts-${version}`} action={saveSlidesAction} className="grid gap-4 border-t border-line pt-4" data-testid="slide-texts">
          <input type="hidden" name="postId" value={props.postId} />
          <div>
            <h3 className="text-sm font-semibold">{t("textsTitle")}</h3>
            <p className="text-xs text-muted">{t("textsHint")}</p>
          </div>
          {props.visual.slides.map((s, i) => {
            const tpl = props.templates!.find((x) => x.id === s.templateId);
            return (
              <fieldset key={i} className="grid gap-2 rounded-lg border border-line p-3">
                <legend className="px-1 text-xs font-medium text-muted">{t("slideN", { n: i + 1, template: tpl?.name ?? s.templateId })}</legend>
                {(tpl?.slots ?? Object.keys(s.slots)).map((slot) => {
                  const id = `slide-${i}-${slot}`;
                  return (
                    <div key={slot} className="grid gap-1">
                      <label htmlFor={id} className="text-xs font-medium">{t(`slots.${slot as "headline"}`)}{props.visual!.slides.length > 1 ? ` · ${i + 1}` : ""}</label>
                      {LONG.has(slot)
                        ? <textarea id={id} name={`s${i}.${slot}`} rows={slot === "body" ? 4 : 2} maxLength={600} defaultValue={s.slots[slot] ?? ""} className={textareaClass} />
                        : <input id={id} name={`s${i}.${slot}`} maxLength={600} defaultValue={s.slots[slot] ?? ""} className={inputClass} />}
                    </div>
                  );
                })}
              </fieldset>
            );
          })}
          <div><button type="submit" disabled={working} className={buttonClass("secondary")}><RefreshCw aria-hidden className="size-4" />{t("saveAndRefresh")}</button></div>
        </form>
      ) : null}
    </Card>
  );
}
