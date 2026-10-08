import { Sparkles, Star, Trash2, UserRound } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AutoRefresh } from "@/app/app/plan/auto-refresh";
import { Badge, buttonClass, Card, EmptyState, inputClass, textareaClass } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { microToUsd } from "@/lib/money/usd";
import { DNA_FIELDS, type PassportStatus, type PersonaDna, type personaImages, type personas } from "@/server/db/schema";
import { DNA_LABELS, DNA_TEXT_MAX, FIELD_MAX } from "@/server/personas/dna";
import { MAX_PASSPORT } from "@/server/personas/service";
import { createPersonaAction, deletePassportImageAction, deletePersonaAction, requestPassportAction, setPersonaInPostsAction, setPrimaryImageAction, updatePersonaAction } from "../persona-actions";
import { DnaText, PassportUpload } from "../persona-uploads";

type Persona = typeof personas.$inferSelect;
type Img = typeof personaImages.$inferSelect;
const TONE: Record<PassportStatus, "neutral" | "signal" | "ok" | "danger"> = { none: "neutral", queued: "signal", rendering: "signal", ready: "ok", failed: "danger" };
const REQUIRED = new Set(["gender", "age", "ethnicity", "hairColour"]);
const LONG = new Set(["ethnicity", "clothing", "environment", "pose", "extra"]);
const euro = (v: bigint) => `${microToUsd(v)} €`;

/** The 13 fields of the DNA framework: inputs for the owner, a list for everyone else. */
function DnaFields({ dna, readOnly }: { dna: PersonaDna | null; readOnly: boolean }) {
  if (readOnly && dna) {
    return (
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]" data-testid="persona-dna">
        {DNA_FIELDS.map((k) => [<dt key={`t-${k}`} className="font-medium">{DNA_LABELS[k].label}</dt>, <dd key={`d-${k}`} className="text-muted">{dna[k] || "—"}</dd>])}
      </dl>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="persona-dna">
      {DNA_FIELDS.map((k) => (
        <div key={k} className={`grid gap-1 ${LONG.has(k) ? "sm:col-span-2" : ""}`}>
          <label htmlFor={`dna-${k}`} className="text-sm font-medium">{DNA_LABELS[k].label}{REQUIRED.has(k) ? " *" : ""}</label>
          {LONG.has(k)
            ? <textarea id={`dna-${k}`} name={`dna.${k}`} rows={2} maxLength={FIELD_MAX} required={REQUIRED.has(k)} defaultValue={dna?.[k] ?? ""} placeholder={DNA_LABELS[k].hint} className={textareaClass} />
            : <input id={`dna-${k}`} name={`dna.${k}`} maxLength={FIELD_MAX} required={REQUIRED.has(k)} defaultValue={dna?.[k] ?? ""} placeholder={DNA_LABELS[k].hint} className={inputClass} />}
        </div>
      ))}
    </div>
  );
}

/**
 * The brand's AI influencer (TASK-024): DNA (by hand, or filled in by Claude from a rough description) and the
 * passport — the pictures every photo and video of the persona starts from.
 */
export async function PersonaSection(props: {
  brandId: string; isOwner: boolean; archived: boolean; error?: string; saved?: boolean;
  data: { persona: Persona; images: Img[] } | null;
  sources: { id: string; filename: string }[];
  dnaCost: bigint | null; passport: { replaces: boolean; maxCost: bigint | null } | null;
}) {
  const t = await getTranslations("Persona");
  const canEdit = props.isOwner && !props.archived;
  const err = props.error ? <p role="alert" className="rounded-lg border border-danger/50 p-3 text-sm">{t.has(`errors.${props.error}`) ? t(`errors.${props.error}`) : t("errors.FAILED")}</p> : null;

  if (!props.data) {
    if (!canEdit) return <EmptyState icon={<UserRound aria-hidden className="size-6" />} title={t("noneTitle")} text={t("noneText")} />;
    return (
      <section aria-labelledby="persona-h" className="grid gap-6" data-testid="persona">
        <div>
          <h2 id="persona-h" className="text-lg font-semibold">{t("title")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t("intro")}</p>
        </div>
        {err}
        <Card className="grid gap-4 p-5" data-testid="persona-ai">
          <h3 className="flex items-center gap-2 font-semibold"><Sparkles aria-hidden className="size-4" />{t("aiTitle")}</h3>
          <p className="max-w-2xl text-sm text-muted">{t("aiHint")}</p>
          <form action={createPersonaAction} className="grid gap-4">
            <input type="hidden" name="brandId" value={props.brandId} />
            <input type="hidden" name="mode" value="ai" />
            <div className="grid gap-1 sm:max-w-xs">
              <label htmlFor="persona-name-ai" className="text-sm font-medium">{t("nameOptional")}</label>
              <input id="persona-name-ai" name="name" maxLength={80} className={inputClass} />
            </div>
            <DnaText brandId={props.brandId} sources={props.sources} max={DNA_TEXT_MAX} />
            <div>
              <SubmitButton pending={t("filling")}>
                {t("fillWithAi")}{props.dnaCost !== null ? ` · ${t("atMost", { cost: euro(props.dnaCost) })}` : ""}
              </SubmitButton>
            </div>
          </form>
        </Card>
        <Card className="p-5" data-testid="persona-manual">
          <details className="grid gap-4">
            <summary className="cursor-pointer font-semibold">{t("manualTitle")}</summary>
            <p className="mt-2 max-w-2xl text-sm text-muted">{t("manualHint")}</p>
            <form action={createPersonaAction} className="mt-4 grid gap-4">
              <input type="hidden" name="brandId" value={props.brandId} />
              <input type="hidden" name="mode" value="manual" />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <label htmlFor="persona-name-m" className="text-sm font-medium">{t("name")} *</label>
                  <input id="persona-name-m" name="name" required maxLength={80} className={inputClass} />
                </div>
                <div className="grid gap-1">
                  <label htmlFor="persona-handle-m" className="text-sm font-medium">{t("handle")}</label>
                  <input id="persona-handle-m" name="handle" maxLength={60} placeholder="@" className={inputClass} />
                </div>
              </div>
              <DnaFields dna={null} readOnly={false} />
              <div><SubmitButton pending={t("saving")}>{t("createManual")}</SubmitButton></div>
            </form>
          </details>
        </Card>
      </section>
    );
  }

  const { persona, images } = props.data;
  const working = persona.passportStatus === "queued" || persona.passportStatus === "rendering";
  const [failCode, ...failRest] = (persona.passportError ?? "FAILED").split(":");
  const replaces = props.passport?.replaces ?? false;
  return (
    <section aria-labelledby="persona-h" className="grid gap-6" data-testid="persona">
      <AutoRefresh active={working} seconds={4} />
      <div>
        <h2 id="persona-h" className="text-lg font-semibold">{persona.name}{persona.handle ? <span className="ml-2 text-sm font-normal text-muted">@{persona.handle}</span> : null}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("introPersona")}</p>
      </div>
      {err}

      <Card className="grid gap-4 p-5" data-testid="passport">
        <h3 className="flex items-center gap-3 font-semibold">
          {t("passportTitle")}
          <span className="text-sm font-normal" data-testid="passport-status"><Badge tone={TONE[persona.passportStatus]} dot>{t(`status.${persona.passportStatus}`)}</Badge></span>
        </h3>
        <p className="max-w-2xl text-sm text-muted">{t("passportHint", { max: MAX_PASSPORT })}</p>
        {persona.passportStatus === "failed" ? <p role="alert" className="rounded-lg border border-danger/50 p-3 text-sm">{t.has(`errors.${failCode}`) ? t(`errors.${failCode}`) : t("errors.FAILED")}{failRest.length ? <span className="mt-1 block text-xs text-muted" data-testid="passport-error-detail">{failRest.join(":")}</span> : null}</p> : null}
        {working ? <p className="text-sm text-muted" aria-live="polite">{t("working")}</p> : null}

        {images.length ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="passport-images">
            {images.map((i) => (
              <li key={i.id} className="grid content-start gap-2">
                <a href={`/api/persona-images/${i.id}`} className={`relative block aspect-[4/5] overflow-hidden rounded-xl bg-paper ring-1 ${i.isPrimary ? "ring-2 ring-signal" : "ring-line"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- private presigned redirect */}
                  <img src={`/api/persona-images/${i.id}`} alt={t("imageAlt", { angle: t(`angles.${i.angle}`) })} className="absolute inset-0 h-full w-full object-cover" />
                </a>
                <div className="flex items-center justify-between gap-1 text-xs">
                  <span className="truncate">{t(`angles.${i.angle}`)}{i.isPrimary ? <> · <strong>{t("primary")}</strong></> : null}</span>
                  {canEdit ? (
                    <span className="flex shrink-0">
                      {!i.isPrimary ? (
                        <form action={setPrimaryImageAction}>
                          <input type="hidden" name="brandId" value={props.brandId} /><input type="hidden" name="imageId" value={i.id} />
                          <button type="submit" title={t("makePrimary")} aria-label={t("makePrimary")} className="grid size-7 place-items-center rounded-md text-muted hover:bg-signal/15 hover:text-fg"><Star aria-hidden className="size-4" /></button>
                        </form>
                      ) : null}
                      <form action={deletePassportImageAction}>
                        <input type="hidden" name="brandId" value={props.brandId} /><input type="hidden" name="imageId" value={i.id} />
                        <button type="submit" title={t("deleteImage")} aria-label={t("deleteImage")} className="grid size-7 place-items-center rounded-md text-muted hover:bg-signal/15 hover:text-fg"><Trash2 aria-hidden className="size-4" /></button>
                      </form>
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">{t("noImages")}</p>}

        {canEdit ? (
          <div className="grid gap-3">
            {props.passport ? (
              <form action={requestPassportAction}>
                <input type="hidden" name="brandId" value={props.brandId} /><input type="hidden" name="personaId" value={persona.id} />
                <button type="submit" disabled={working} className={buttonClass(replaces ? "secondary" : "primary")} data-testid="passport-generate">
                  <Sparkles aria-hidden className="size-4" />
                  {replaces ? t("generateAgain") : t("generateFirst")}
                  {props.passport.maxCost !== null ? ` · ${t("atMost", { cost: euro(props.passport.maxCost) })}` : ""}
                </button>
              </form>
            ) : null}
            <PassportUpload personaId={persona.id} room={MAX_PASSPORT - images.length} />
          </div>
        ) : null}
      </Card>

      <Card className="grid gap-3 p-5" data-testid="persona-in-posts">
        <h3 className="flex items-center gap-3 font-semibold">
          {t("inPostsTitle")}
          <span className="text-sm font-normal"><Badge tone={persona.useInPosts ? "ok" : "neutral"} dot>{persona.useInPosts ? t("inPostsOn") : t("inPostsOff")}</Badge></span>
        </h3>
        <p className="max-w-2xl text-sm text-muted">{t("inPostsHint")}</p>
        {canEdit ? (
          <form action={setPersonaInPostsAction}>
            <input type="hidden" name="brandId" value={props.brandId} /><input type="hidden" name="personaId" value={persona.id} />
            <input type="hidden" name="on" value={persona.useInPosts ? "0" : "1"} />
            <button type="submit" className={buttonClass("secondary", "sm")}>{persona.useInPosts ? t("inPostsDisable") : t("inPostsEnable")}</button>
          </form>
        ) : null}
      </Card>

      <Card className="grid gap-4 p-5">
        <h3 className="font-semibold">{t("dnaTitle")}</h3>
        {props.saved ? <p role="status" className="text-sm text-signal">{t("saved")}</p> : null}
        {canEdit ? (
          <form action={updatePersonaAction} className="grid gap-4">
            <input type="hidden" name="brandId" value={props.brandId} /><input type="hidden" name="personaId" value={persona.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <label htmlFor="persona-name" className="text-sm font-medium">{t("name")} *</label>
                <input id="persona-name" name="name" required maxLength={80} defaultValue={persona.name} className={inputClass} />
              </div>
              <div className="grid gap-1">
                <label htmlFor="persona-handle" className="text-sm font-medium">{t("handle")}</label>
                <input id="persona-handle" name="handle" maxLength={60} defaultValue={persona.handle} placeholder="@" className={inputClass} />
              </div>
            </div>
            <DnaFields dna={persona.dna} readOnly={false} />
            <p className="text-xs text-muted">{t("dnaHint")}</p>
            <div><SubmitButton pending={t("saving")}>{t("save")}</SubmitButton></div>
          </form>
        ) : <DnaFields dna={persona.dna} readOnly />}
      </Card>

      {canEdit ? (
        <details className="justify-self-start text-sm">
          <summary className="cursor-pointer text-muted">{t("deletePersona")}</summary>
          <form action={deletePersonaAction} className="mt-2 grid gap-2">
            <input type="hidden" name="brandId" value={props.brandId} /><input type="hidden" name="personaId" value={persona.id} />
            <p className="max-w-md text-muted">{t("deleteWarning")}</p>
            <button type="submit" className={buttonClass("secondary", "sm")}><Trash2 aria-hidden className="size-4" />{t("deleteConfirm", { name: persona.name })}</button>
          </form>
        </details>
      ) : null}
    </section>
  );
}
