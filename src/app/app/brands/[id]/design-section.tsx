import Link from "next/link";
import { Check, Circle, Loader2, Palette, Sparkles, Wand2 } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { AutoRefresh } from "@/app/app/plan/auto-refresh";
import { Badge, buttonClass, Card, DataTable, selectClass, td, textareaClass } from "@/components/ui";
import type { brandDesigns } from "@/server/db/schema";
import { activateDesignAction, requestDesignAction, restoreDesignTemplateAction } from "../actions";

type Design = typeof brandDesigns.$inferSelect;
const SHAPES = ["portrait", "square", "landscape"] as const;

/**
 * A brand's visual system (TASK-017): Claude makes it from the CGP, the owner's description, colours, logo and past
 * posts; the owner reviews the templates and corrects them in words; every version is kept.
 */
export async function DesignSection(props: {
  brandId: string;
  designs: Design[];
  currentId: string | null;
  isOwner: boolean;
  archived: boolean;
  inputs: { cgp: boolean; examples: number; logo: boolean; font: boolean };
  shape: (typeof SHAPES)[number];
  error?: string;
  filesHref: string;
}) {
  const t = await getTranslations("Design");
  const f = await getFormatter();
  const current = props.designs.find((d) => d.id === props.currentId && d.status === "ready") ?? null;
  const latest = props.designs[0];
  const working = latest?.status === "generating";
  const canEdit = props.isOwner && !props.archived;
  const base = `/app/brands/${props.brandId}?tab=design`;
  // TASK-054: what a version is — made from the description, a revision (maybe of picked templates) or a template brought back.
  const nameOf = (d: Design, id: string) => props.designs.find((x) => x.id === d.basedOn)?.spec?.templates.find((tp) => tp.id === id)?.name ?? id;
  const whatText = (d: Design) => {
    if (d.restoredFrom) return t("restoredTemplate", { name: d.restoredFrom.name, v: d.restoredFrom.version });
    if (!d.instruction) return t("fromScratch");
    return d.onlyTemplates?.length ? `${t("onlyTemplates", { list: d.onlyTemplates.map((id) => nameOf(d, id)).join(", ") })} · ${d.instruction}` : d.instruction;
  };

  const createForm = (lead: boolean) => (
    <form action={requestDesignAction} className="grid gap-3" data-testid="design-create">
      <input type="hidden" name="brandId" value={props.brandId} />
      <label htmlFor="design-brief" className="text-sm font-medium">{t("briefLabel")}</label>
      <p id="design-brief-hint" className="text-xs text-muted">{t("briefHint")}</p>
      <textarea id="design-brief" name="brief" rows={5} maxLength={4000} defaultValue={latest?.brief ?? ""} aria-describedby="design-brief-hint" className={textareaClass} />
      <div><button type="submit" disabled={working} className={buttonClass(lead ? "primary" : "secondary")}><Sparkles aria-hidden className="size-4" />{lead ? t("create") : t("recreate")}</button></div>
    </form>
  );

  return (
    <section aria-labelledby="design-h" className="grid gap-6" data-testid="design">
      <AutoRefresh active={working} seconds={4} />
      <div>
        <h2 id="design-h" className="text-base font-semibold">{t("title")}</h2>
        <p className="max-w-3xl text-sm text-muted">{t("intro")}</p>
      </div>

      {props.error ? <p role="alert" className="rounded-lg border border-danger/50 px-3 py-2 text-sm text-danger">{t(`errors.${props.error}`)}</p> : null}
      {working ? (
        // TASK-056: what Claude is doing while it designs (the steps of every run; no per-step tracking).
        <Card className="grid gap-3 border-signal/40 p-5" data-testid="design-working">
          <p className="flex items-center gap-2 text-sm font-semibold" aria-live="polite"><Loader2 aria-hidden className="size-4 animate-spin text-accent-text" />{latest.instruction ? t("revising") : t("working")}</p>
          <ol className="grid gap-2 text-sm text-muted">
            {(["read", "look", "draw", "check"] as const).map((k, i) => (
              <li key={k} className="flex items-center gap-2"><span aria-hidden className="grid size-5 place-items-center rounded-full bg-raised text-[11px] font-semibold text-fg">{i + 1}</span>{t(`steps.${k}`, { n: props.inputs.examples })}</li>
            ))}
          </ol>
          <p className="text-xs text-muted">{t("workingHint")}</p>
        </Card>
      ) : null}
      {latest?.status === "failed" && !working ? (
        <p role="alert" className="rounded-lg border border-danger/50 px-3 py-2 text-sm" data-testid="design-failed">
          {t("failed", { reason: t.has(`errors.${(latest.error ?? "FAILED").split(":")[0]}`) ? t(`errors.${(latest.error ?? "FAILED").split(":")[0]}`) : t("errors.FAILED") })}
          {latest.error?.includes(":") ? <span className="mt-1 block text-xs text-muted">{latest.error.slice(latest.error.indexOf(":") + 1)}</span> : null}
        </p>
      ) : null}

      {!current ? (
        <Card className="grid gap-5 p-6">
          <ul className="grid gap-2 sm:grid-cols-2" data-testid="design-inputs">
            {([["cgp", props.inputs.cgp], ["examples", props.inputs.examples > 0], ["logo", props.inputs.logo], ["font", props.inputs.font]] as const).map(([k, ok]) => (
              <li key={k} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${ok ? "border-ok/30 bg-ok/5" : "border-line"}`}>
                {ok ? <Check aria-hidden className="size-4 shrink-0 text-ok" /> : <Circle aria-hidden className="size-4 shrink-0 text-muted" />}
                <span><span className="sr-only">{ok ? t("inputs.have") : t("inputs.missing")}: </span>{t(`inputs.${k}`, { n: props.inputs.examples })}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">{t("examplesHint")} <Link href={props.filesHref} className="underline underline-offset-4">{t("toFiles")}</Link></p>
          {canEdit ? createForm(true) : <p className="text-sm text-muted">{t("ownerOnly")}</p>}
        </Card>
      ) : (
        <>
          <Card className="grid gap-4 p-5" data-testid="design-summary">
            <div className="flex flex-wrap items-center gap-3">
              <Palette aria-hidden className="size-4 text-muted" />
              <strong>{t("version", { v: current.version })}</strong>
              <ul className="flex gap-1.5" aria-label={t("palette")}>
                {Object.entries(current.spec!.palette).filter(([, v]) => v).map(([k, v]) => (
                  <li key={k} title={`${k} ${v}`} className="size-6 rounded-full ring-1 ring-line" style={{ backgroundColor: v as string }}><span className="sr-only">{k} {v}</span></li>
                ))}
              </ul>
              <span className="text-sm text-muted">{t("typography", { heading: current.spec!.typography.heading, body: current.spec!.typography.body })}</span>
            </div>
            <p className="text-sm">{current.spec!.summary}</p>
            <p className="text-xs text-muted"><span className="font-medium">{t("illustrationStyle")}:</span> {current.spec!.illustrationStyle}</p>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">{t("templates", { n: current.spec!.templates.length })}</h3>
            <nav aria-label={t("shapeLabel")} className="inline-flex rounded-lg border border-line p-0.5">
              {SHAPES.map((s) => (
                <Link key={s} href={`${base}&shape=${s}`} aria-current={s === props.shape ? "page" : undefined}
                  className={`rounded-md px-3 py-1 text-sm ${s === props.shape ? "bg-raised font-medium text-fg" : "text-muted hover:text-fg"}`}>{t(`shapes.${s}`)}</Link>
              ))}
            </nav>
          </div>
          <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3" data-testid="design-templates">
            {current.spec!.templates.map((tp) => (
              <li key={tp.id} className="grid content-start gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- server-rendered PNG preview */}
                <img src={`/api/designs/${current.id}/preview?template=${tp.id}&shape=${props.shape}`} alt={t("previewAlt", { name: tp.name })} className="w-full rounded-2xl shadow-xl shadow-black/30 ring-1 ring-line" loading="lazy" />
                <p className="text-sm font-medium">{tp.name}</p>
                <p className="text-xs text-muted">{tp.use}</p>
                {/* TASK-054: picked templates limit the revision below to them. */}
                {canEdit ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="templateId" value={tp.id} form="design-revise-form" disabled={working} aria-label={t("pickTemplateAria", { name: tp.name })} className="size-4 accent-signal" data-testid="design-pick" />
                    <span aria-hidden>{t("pickTemplate")}</span>
                  </label>
                ) : null}
              </li>
            ))}
          </ul>

          {canEdit ? (
            <Card className="grid gap-3 p-5">
              <form id="design-revise-form" action={requestDesignAction} className="grid gap-3" data-testid="design-revise">
                <input type="hidden" name="brandId" value={props.brandId} />
                <label htmlFor="design-instruction" className="text-sm font-medium">{t("reviseLabel")}</label>
                <p id="design-instruction-hint" className="text-xs text-muted">{t("reviseHint")} {t("pickHint")}</p>
                <textarea id="design-instruction" name="instruction" rows={3} required minLength={3} maxLength={2000} aria-describedby="design-instruction-hint" className={textareaClass} />
                <div><button type="submit" disabled={working} className={buttonClass("primary")}><Wand2 aria-hidden className="size-4" />{t("revise")}</button></div>
              </form>
              <details className="border-t border-line pt-3">
                <summary className="cursor-pointer text-sm text-muted">{t("recreateTitle")}</summary>
                <div className="mt-3">{createForm(false)}</div>
              </details>
            </Card>
          ) : null}
        </>
      )}

      {props.designs.length ? (
        <DataTable testId="design-versions" head={[t("versionCol"), t("lookCol"), t("whatCol"), t("statusCol"), t("dateCol"), ""]}>
          {props.designs.map((d) => (
            <tr key={d.id}>
              <td className={`${td} font-medium`}>v{d.version}</td>
              <td className={td}>
                {/* TASK-056: each version at a glance — its first template and its colours. */}
                {d.status === "ready" && d.spec ? (
                  <span className="flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- server-rendered PNG preview */}
                    <img src={`/api/designs/${d.id}/preview?template=${d.spec.templates[0]?.id}&shape=square`} alt="" loading="lazy" className="size-12 rounded-md object-cover ring-1 ring-line" />
                    <span className="flex gap-1" aria-hidden>
                      {[d.spec.palette.background, d.spec.palette.accent, d.spec.palette.text].map((c, i) => <span key={i} className="size-3 rounded-full ring-1 ring-line" style={{ backgroundColor: c }} />)}
                    </span>
                  </span>
                ) : <span className="text-muted">—</span>}
              </td>
              <td className={td}>{whatText(d)}</td>
              <td className={td}>
                {d.id === current?.id ? <Badge tone="ok" dot>{t("inUse")}</Badge> : <Badge tone={d.status === "failed" ? "danger" : d.status === "generating" ? "signal" : "neutral"}>{t(`status.${d.status}`)}</Badge>}
              </td>
              <td className={`${td} whitespace-nowrap text-muted`}>{f.dateTime(d.createdAt, { dateStyle: "short", timeStyle: "short" })}</td>
              <td className={td}>
                {canEdit && d.status === "ready" && d.id !== current?.id ? (
                  <div className="grid justify-items-start gap-1">
                    <form action={activateDesignAction}>
                      <input type="hidden" name="brandId" value={props.brandId} />
                      <input type="hidden" name="designId" value={d.id} />
                      <button type="submit" className={buttonClass("ghost", "sm")}>{t("activate")}</button>
                    </form>
                    {/* TASK-054: one template of this version back into the current design, no AI call. */}
                    {current && d.spec?.templates.length ? (
                      <details className="text-sm" data-testid="design-restore-template">
                        <summary className={`${buttonClass("ghost", "sm")} cursor-pointer list-none`}>{t("restoreTemplateLabel")}</summary>
                        <form action={restoreDesignTemplateAction} className="mt-2 grid max-w-xs gap-2">
                          <input type="hidden" name="brandId" value={props.brandId} />
                          <input type="hidden" name="designId" value={d.id} />
                          <select name="templateId" aria-label={t("restoreTemplateLabel")} className={selectClass}>
                            {d.spec.templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
                          </select>
                          <p className="text-xs text-muted">{t("restoreHint")}</p>
                          <button type="submit" disabled={working} className={buttonClass("secondary", "sm")}>{t("restoreTemplate")}</button>
                        </form>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </DataTable>
      ) : null}
    </section>
  );
}
