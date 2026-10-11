// Brand setup wizard (TASK-055, ADR-081): what a brand still needs before Postaja can make good posts for it. Each step
// is "done", "missing" (required: posts or images will be poor or impossible) or "recommended" (results get better).
// Computed from what is stored — nothing extra is saved — so the wizard and the brand page always agree.
import type { Db } from "../db/client";
import { listBrandFiles } from "./files";
import { getBrandDetail } from "./service";
import { listDesigns } from "../design/service";
import type { OrgContext } from "../tenancy/context";

export const SETUP_STEPS = ["cgp", "images", "materials", "rules", "visual", "channels", "design", "done"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export type StepState = "done" | "missing" | "recommended";

/** A CGP shorter than this rarely says enough about tone, audience and offer. */
export const CGP_MIN_CHARS = 400;
export const EXAMPLES_MIN = 3;

export type Readiness = {
  steps: Record<Exclude<SetupStep, "done">, { state: StepState; detail: Record<string, number | boolean | string> }>;
  /** 0–100: required steps weigh twice. */
  score: number;
  /** Required steps still missing (in wizard order). */
  missing: SetupStep[];
  /** The first step that is not done (or "done"). */
  next: SetupStep;
  designWorking: boolean;
};

export async function brandReadiness(db: Db, ctx: OrgContext, brandId: string): Promise<Readiness> {
  const [{ profile, channels }, files, designs] = await Promise.all([getBrandDetail(db, ctx, brandId), listBrandFiles(db, ctx, brandId), listDesigns(db, ctx, brandId)]);
  const cgpChars = profile?.cgp.trim().length ?? 0;
  const examples = files.sources.filter((s) => s.kind === "image").length;
  const docs = files.sources.filter((s) => s.kind !== "image").length;
  const pillars = profile?.pillars.length ?? 0;
  const ctas = profile?.rules.ctaPhrases.length ?? 0;
  const colors = Object.values(profile?.visual.colors ?? {}).filter(Boolean).length;
  const imageStyle = !!profile?.visual.imageStyle.trim();
  const designReady = designs.some((d) => d.status === "ready");
  const designWorking = designs[0]?.status === "generating";
  const steps: Readiness["steps"] = {
    cgp: { state: cgpChars >= CGP_MIN_CHARS ? "done" : "missing", detail: { chars: cgpChars, min: CGP_MIN_CHARS } },
    images: { state: files.logos.length === 0 ? "missing" : examples >= EXAMPLES_MIN ? "done" : "recommended", detail: { logos: files.logos.length, examples, min: EXAMPLES_MIN, fonts: files.fonts.length } },
    materials: { state: docs > 0 ? "done" : "recommended", detail: { docs } },
    rules: { state: pillars >= 2 && ctas >= 1 ? "done" : "recommended", detail: { pillars, ctas } },
    visual: { state: colors >= 2 || imageStyle ? "done" : "recommended", detail: { colors, imageStyle } },
    channels: { state: channels.length > 0 ? "done" : "missing", detail: { channels: channels.length } },
    design: { state: designReady ? "done" : "missing", detail: { working: designWorking } },
  };
  const keys = Object.keys(steps) as (keyof Readiness["steps"])[];
  const required = (k: keyof Readiness["steps"]) => k === "cgp" || k === "channels" || k === "design" || (k === "images" && files.logos.length === 0);
  // Weight: required steps (cgp, images with the logo, channels, design) 2, the rest 1; a logo without enough past posts
  // counts half of its step.
  const weight = (k: keyof Readiness["steps"]) => (k === "cgp" || k === "channels" || k === "design" || k === "images" ? 2 : 1);
  const total = keys.reduce((n, k) => n + weight(k), 0);
  const got = keys.reduce((n, k) => n + (steps[k].state === "done" ? weight(k) : k === "images" && files.logos.length > 0 ? weight(k) / 2 : 0), 0);
  const missing = keys.filter((k) => steps[k].state === "missing" && required(k));
  const next = keys.find((k) => steps[k].state !== "done") ?? "done";
  return { steps, score: Math.round((got / total) * 100), missing, next, designWorking };
}
