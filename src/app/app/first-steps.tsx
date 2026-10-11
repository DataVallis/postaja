import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { FIRST_STEPS, type FirstStep } from "@/server/signup/service";

/**
 * Prvi koraki (TASK-037): on the dashboard of a self-serve organization until all five are done — a brand, its CGP,
 * a plan import, a first post, a first download. Each open step links to where it is done.
 */
export async function FirstSteps({ done, firstBrandId }: { done: Record<FirstStep, boolean>; firstBrandId: string | null }) {
  const t = await getTranslations("Dashboard.firstSteps");
  const href: Record<FirstStep, string> = {
    brand: "/app/brands/new",
    cgp: firstBrandId ? `/app/brands/${firstBrandId}/setup?step=cgp` : "/app/brands/new",
    plan: "/app/import",
    post: firstBrandId ? `/app/brands/${firstBrandId}?tab=posts` : "/app/brands/new",
    download: "/app/plan?view=day",
  };
  const n = FIRST_STEPS.filter((s) => done[s]).length;
  return (
    <section aria-labelledby="first-steps-h" className="mb-8 rounded-2xl border border-signal/50 p-6" data-testid="first-steps">
      <h2 id="first-steps-h" className="text-base font-semibold">{t("title")}</h2>
      <p className="mb-4 text-sm text-muted">{t("progress", { n, total: FIRST_STEPS.length })}</p>
      <ol className="grid gap-2">
        {FIRST_STEPS.map((s, i) => (
          <li key={s} className="flex items-start gap-3 text-sm" data-testid={`first-step-${s}`} data-done={done[s] ? "1" : "0"}>
            {done[s] ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-ok" /> : <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />}
            <span>
              <span className="sr-only">{done[s] ? t("doneLabel") : t("openLabel")}: </span>
              {done[s] ? <span className="text-muted line-through">{i + 1}. {t(`steps.${s}.title`)}</span>
                : <><Link href={href[s]} className="font-semibold underline underline-offset-4">{i + 1}. {t(`steps.${s}.title`)}</Link> <span className="text-muted">— {t(`steps.${s}.hint`)}</span></>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
