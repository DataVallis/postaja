import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Check, CircleAlert, CircleDashed } from "lucide-react";
import { AutoRefresh } from "@/app/app/plan/auto-refresh";
import { Badge, buttonClass, Card, PageHeader, textareaClass } from "@/components/ui";
import { requireOrgPage } from "@/server/auth/require";
import { listBrandFiles } from "@/server/brands/files";
import { brandReadiness, CGP_MIN_CHARS, EXAMPLES_MIN, SETUP_STEPS, type SetupStep, type StepState } from "@/server/brands/readiness";
import { BrandError, getBrandDetail } from "@/server/brands/service";
import { getDb } from "@/server/db/client";
import { listDesigns } from "@/server/design/service";
import { pendingDraft } from "@/server/mcp/service";
import { listPresets } from "@/server/rules/repo";
import { requestDesignAction } from "../../actions";
import { AddLogoButton, Dropzone } from "../../file-uploads";
import { ChannelForm } from "../../forms";
import { CgpStep, RulesStep, VisualStep } from "./forms";

export const dynamic = "force-dynamic";

/**
 * Brand setup wizard (TASK-055, ADR-081): step by step through everything Postaja needs for good posts — CGP, logo and
 * past posts, materials, topics and rules, colours and image style, channels, the brand design — with why each matters.
 * Every step saves into the brand as usual; the stepper shows what is done, missing (required) or recommended.
 */
export default async function BrandSetupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string; designError?: string }> }) {
  const { org } = await requireOrgPage();
  const { id } = await params;
  const sp = await searchParams;
  if (org.role !== "owner") redirect(`/app/brands/${id}`);
  const db = getDb();
  const detail = await getBrandDetail(db, org, id).catch((e) => { if (e instanceof BrandError) return null; throw e; });
  if (!detail) notFound();
  const { brand, profile, channels } = detail;
  if (brand.archivedAt) redirect(`/app/brands/${id}`);
  const [ready, files, draft, designs, presets] = await Promise.all([brandReadiness(db, org, id), listBrandFiles(db, org, id), pendingDraft(db, org, id), listDesigns(db, org, id), listPresets(db)]);
  const t = await getTranslations("Setup");
  const f = await getFormatter();
  const step: SetupStep = (SETUP_STEPS as readonly string[]).includes(sp.step ?? "") ? (sp.step as SetupStep) : ready.next;
  const i = SETUP_STEPS.indexOf(step);
  const base = `/app/brands/${id}/setup`;
  const at = (s: SetupStep) => `${base}?step=${s}`;
  const next = SETUP_STEPS[Math.min(i + 1, SETUP_STEPS.length - 1)];
  const prevHref = i > 0 ? at(SETUP_STEPS[i - 1]) : null;
  const stateOf = (s: SetupStep): StepState | "summary" => (s === "done" ? "summary" : ready.steps[s].state);
  const icon = (s: StepState | "summary") =>
    s === "done" ? <Check aria-hidden className="size-4 text-ok" /> : s === "missing" ? <CircleAlert aria-hidden className="size-4 text-danger" /> : <CircleDashed aria-hidden className="size-4 text-muted" />;
  const nextLinks = (label?: string) => (
    <div className="flex flex-wrap gap-2">
      {prevHref ? <Link href={prevHref} className={buttonClass("ghost")}>{t("back")}</Link> : null}
      <Link href={at(next)} className={buttonClass("primary")}>{label ?? t("next")}</Link>
    </div>
  );
  const why = (s: Exclude<SetupStep, "done">) => (
    <div className="grid gap-2 text-sm">
      <p className="max-w-3xl">{t(`steps.${s}.intro`)}</p>
      <ul className="grid list-disc gap-1 pl-5 text-muted">
        {(t.raw(`steps.${s}.tips`) as string[]).map((tip) => <li key={tip}>{tip}</li>)}
      </ul>
    </div>
  );

  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/app/brands/${id}`} className="hover:text-fg hover:underline">{brand.name}</Link>}
        title={t("title")}
        description={t("subtitle")}
        actions={<Link href={`/app/brands/${id}`} className={buttonClass("secondary", "sm")}>{t("skip")}</Link>}
      />
      <div className="mb-6 grid gap-2" data-testid="setup-progress">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>{t("score", { n: ready.score })}</span>
          {ready.missing.length ? <span className="text-danger">{t("missingRequired", { list: ready.missing.map((m) => t(`steps.${m}.short`)).join(", ") })}</span> : <span className="text-ok">{t("allRequired")}</span>}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={ready.score} aria-valuemin={0} aria-valuemax={100} aria-label={t("progressLabel")}>
          <div className="h-full bg-signal" style={{ width: `${ready.score}%` }} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <nav aria-label={t("stepsLabel")}>
          <ol className="grid gap-1" data-testid="setup-steps">
            {SETUP_STEPS.map((s, n) => (
              <li key={s}>
                <Link href={at(s)} aria-current={s === step ? "step" : undefined}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${s === step ? "bg-raised font-semibold" : "hover:bg-raised"}`}>
                  {icon(stateOf(s))}
                  <span>{n + 1}. {t(`steps.${s}.short`)}</span>
                  {s !== "done" && ready.steps[s].state === "missing" ? <span className="sr-only">{t("stateMissing")}</span> : null}
                  {s !== "done" && ready.steps[s].state === "done" ? <span className="sr-only">{t("stateDone")}</span> : null}
                </Link>
              </li>
            ))}
          </ol>
        </nav>

        <Card className="grid content-start gap-6 p-5" data-testid={`setup-step-${step}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{i + 1}. {t(`steps.${step}.title`)}</h2>
            {step !== "done" ? (
              <Badge tone={ready.steps[step].state === "done" ? "ok" : ready.steps[step].state === "missing" ? "danger" : "neutral"} dot>
                {t(ready.steps[step].state === "done" ? "badgeDone" : ready.steps[step].state === "missing" ? "badgeRequired" : "badgeRecommended")}
              </Badge>
            ) : null}
          </div>

          {step === "cgp" ? (
            <>
              {why("cgp")}
              <CgpStep brandId={id} cgp={profile?.cgp ?? ""} min={CGP_MIN_CHARS} next={next} prevHref={prevHref}
                sources={files.sources.filter((s) => s.kind === "pdf" || s.kind === "docx" || s.kind === "text").map((s) => ({ id: s.id, filename: s.filename }))}
                draft={draft ? { id: draft.id, text: draft.text, note: draft.note, when: f.dateTime(draft.createdAt, { dateStyle: "medium", timeStyle: "short" }) } : null} />
            </>
          ) : null}

          {step === "images" ? (
            <>
              {why("images")}
              {files.logos.length && (ready.steps.images.detail.examples as number) < EXAMPLES_MIN ? (
                <p role="status" className="rounded-lg border border-ok/40 p-3 text-sm" data-testid="setup-images-logo-done">
                  {t("images.logoDoneMore", { k: EXAMPLES_MIN - (ready.steps.images.detail.examples as number) })}
                </p>
              ) : null}
              <ul className="grid gap-1 text-sm" data-testid="setup-images-status">
                <li className="flex items-center gap-2">{icon(files.logos.length ? "done" : "missing")}{files.logos.length ? t("images.logoOk", { n: files.logos.length }) : t("images.logoMissing")}</li>
                <li className="flex items-center gap-2">{icon((ready.steps.images.detail.examples as number) >= EXAMPLES_MIN ? "done" : "recommended")}{t("images.examples", { n: ready.steps.images.detail.examples as number, min: EXAMPLES_MIN })}</li>
                <li className="flex items-center gap-2">{icon(files.fonts.length ? "done" : "recommended")}{files.fonts.length ? t("images.fontOk", { n: files.fonts.length }) : t("images.fontNone")}</li>
              </ul>
              <Dropzone brandId={id} needsDiacritics={brand.languages.includes("sl")} />
              {files.logos.length ? null : <div><AddLogoButton brandId={id} /></div>}
              {nextLinks()}
            </>
          ) : null}

          {step === "materials" ? (
            <>
              {why("materials")}
              {files.sources.filter((s) => s.kind !== "image").length ? (
                <ul className="grid gap-1 text-sm" data-testid="setup-materials">
                  {files.sources.filter((s) => s.kind !== "image").map((s) => <li key={s.id} className="flex items-center gap-2"><Check aria-hidden className="size-4 text-ok" />{s.filename}</li>)}
                </ul>
              ) : <p className="text-sm text-muted">{t("materials.none")}</p>}
              <Dropzone brandId={id} needsDiacritics={brand.languages.includes("sl")} />
              {nextLinks()}
            </>
          ) : null}

          {step === "rules" ? (
            <>
              {why("rules")}
              <RulesStep brandId={id} pillars={profile?.pillars ?? []} rules={profile?.rules ?? { bannedWords: [], ctaPhrases: [], regexMust: [], regexMustNot: [] }} next={next} prevHref={prevHref} />
            </>
          ) : null}

          {step === "visual" ? (
            <>
              {why("visual")}
              <VisualStep brandId={id} visual={profile?.visual ?? { colors: {}, imageStyle: "", negativePrompt: "" }} next={next} prevHref={prevHref} />
            </>
          ) : null}

          {step === "channels" ? (
            <>
              {why("channels")}
              {channels.length ? (
                <ul className="grid gap-1 text-sm" data-testid="setup-channels">
                  {channels.map((c) => <li key={c.id} className="flex items-center gap-2"><Check aria-hidden className="size-4 text-ok" />{c.platform} · {c.handle}</li>)}
                </ul>
              ) : <p className="text-sm text-danger">{t("channels.none")}</p>}
              <ChannelForm brandId={id} languages={brand.languages} presets={presets.filter((p) => p.enabled).map((p) => ({ key: p.key, platform: p.platform, width: p.width, height: p.height, media: p.media }))} />
              {nextLinks()}
            </>
          ) : null}

          {step === "design" ? (
            <>
              <AutoRefresh active={ready.designWorking} seconds={4} />
              {why("design")}
              {ready.steps.cgp.state !== "done" ? <p role="alert" className="text-sm text-danger">{t("design.needCgp")}</p> : null}
              {!files.logos.length ? <p className="text-sm text-warn">{t("design.noLogo")}</p> : null}
              {sp.designError ? <p role="alert" className="text-sm text-danger">{t("design.error")}</p> : null}
              {ready.designWorking ? <p role="status" className="text-sm" data-testid="setup-design-working">{t("design.working")}</p> : null}
              {ready.steps.design.state === "done" ? (
                <p className="text-sm" data-testid="setup-design-ready">
                  {t("design.ready")} <Link href={`/app/brands/${id}?tab=design`} className="underline underline-offset-4">{t("design.review")}</Link>
                </p>
              ) : null}
              {!ready.designWorking ? (
                <form action={requestDesignAction} className="grid gap-3" data-testid="setup-design-form">
                  <input type="hidden" name="brandId" value={id} />
                  <input type="hidden" name="returnTo" value={at("design")} />
                  <label htmlFor="setup-brief" className="text-sm font-medium">{t("design.brief")}</label>
                  <p id="setup-brief-hint" className="text-xs text-muted">{t("design.briefHint")}</p>
                  <textarea id="setup-brief" name="brief" rows={4} maxLength={4000} defaultValue={designs[0]?.brief ?? profile?.visual.imageStyle ?? ""} aria-describedby="setup-brief-hint" className={textareaClass} />
                  <div><button type="submit" disabled={ready.steps.cgp.state !== "done"} className={buttonClass(ready.steps.design.state === "done" ? "secondary" : "primary")}>
                    {ready.steps.design.state === "done" ? t("design.again") : t("design.create")}
                  </button></div>
                </form>
              ) : null}
              {nextLinks()}
            </>
          ) : null}

          {step === "done" ? (
            <>
              <p className="text-sm">{ready.missing.length ? t("done.notYet") : t("done.ready")}</p>
              <ul className="grid gap-2 text-sm" data-testid="setup-summary">
                {SETUP_STEPS.filter((s): s is Exclude<SetupStep, "done"> => s !== "done").map((s) => (
                  <li key={s} className="flex flex-wrap items-center gap-2">
                    {icon(ready.steps[s].state)}
                    <Link href={at(s)} className="underline-offset-4 hover:underline">{t(`steps.${s}.short`)}</Link>
                    <span className="text-muted">{t(ready.steps[s].state === "done" ? "badgeDone" : ready.steps[s].state === "missing" ? "badgeRequired" : "badgeRecommended")}</span>
                  </li>
                ))}
              </ul>
              <div className="grid gap-2">
                <p className="text-sm font-medium">{t("done.nextTitle")}</p>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/app/brands/${id}`} className={buttonClass(ready.missing.length ? "secondary" : "primary")}>{t("done.firstPost")}</Link>
                  <Link href="/app/import" className={buttonClass("secondary")}>{t("done.import")}</Link>
                </div>
                <p className="mt-2 text-sm font-medium">{t("done.extrasTitle")}</p>
                <ul className="grid list-disc gap-1 pl-5 text-sm">
                  <li><Link href={`/app/brands/${id}?tab=persona`} className="underline underline-offset-4">{t("done.persona")}</Link></li>
                  <li><Link href={`/app/brands/${id}?tab=competitors`} className="underline underline-offset-4">{t("done.competitors")}</Link></li>
                  <li><Link href={`/app/brands/${id}?tab=files`} className="underline underline-offset-4">{t("done.partners")}</Link></li>
                  <li><Link href="/app/connect" className="underline underline-offset-4">{t("done.claude")}</Link></li>
                </ul>
              </div>
            </>
          ) : null}
        </Card>
      </div>
    </>
  );
}
