// Motion design for post animations (TASK-023, ADR-052): Claude writes a small motion spec for one image — when and
// how each element of the brand template enters, how the illustration drifts, gentle loops — and Postaja renders it
// frame by frame. It is data, never code; every letter is still drawn by Postaja (ADR-009), so any image can move.
import { z } from "zod";

export const FPS = 25;
export const MIN_S = 3;
export const MAX_S = 10;

export const ENTER_EFFECTS = ["none", "fade", "rise", "drop", "slide_left", "slide_right", "pop", "grow_x", "grow_y", "words"] as const;
export const LOOPS = ["none", "pulse", "float", "breathe"] as const;
export const BG_MOTIONS = ["none", "zoom_in", "zoom_out", "pan_left", "pan_right", "pan_up", "pan_down"] as const;
export const EASES = ["linear", "out", "in_out", "back"] as const;

export const motionSpecSchema = z.object({
  durationS: z.number().min(MIN_S).max(MAX_S),
  background: z.object({ motion: z.enum(BG_MOTIONS), amount: z.number().min(0).max(0.25).default(0.08) }),
  elements: z.array(z.object({
    /** Index of the element in the template's element list. */
    index: z.number().int().min(0).max(39),
    enter: z.object({
      effect: z.enum(ENTER_EFFECTS),
      /** Seconds from the start. */
      at: z.number().min(0).max(MAX_S),
      duration: z.number().min(0.1).max(4),
      ease: z.enum(EASES).default("out"),
    }),
    loop: z.enum(LOOPS).default("none"),
  })).max(40),
});
export type MotionSpec = z.infer<typeof motionSpecSchema>;

/** What an element looks like at time t: opacity, offset (px), scale (x, y), share of its words shown. */
export type ElementState = { opacity: number; dx: number; dy: number; sx: number; sy: number; words: number; origin: "center" | "left" | "top" };

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
function ease(kind: (typeof EASES)[number], p: number): number {
  const x = clamp(p);
  if (kind === "linear") return x;
  if (kind === "in_out") return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
  if (kind === "back") { const c = 1.4; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; }
  return 1 - (1 - x) ** 3; // out (cubic)
}

const STILL: ElementState = { opacity: 1, dx: 0, dy: 0, sx: 1, sy: 1, words: 1, origin: "center" };

/** The state of element `index` at `t` seconds for a canvas `width` px wide (offsets scale with the canvas). */
export function elementState(spec: MotionSpec | null | undefined, index: number, t: number, width: number): ElementState {
  const m = spec?.elements.find((e) => e.index === index);
  if (!m) return STILL;
  const { effect, at, duration } = m.enter;
  const p = ease(m.enter.ease, (t - at) / duration);
  const lin = clamp((t - at) / duration);
  const travel = width * 0.06;
  const s: ElementState = { ...STILL };
  switch (effect) {
    case "fade": s.opacity = lin; break;
    case "rise": s.opacity = lin; s.dy = (1 - p) * travel; break;
    case "drop": s.opacity = lin; s.dy = -(1 - p) * travel; break;
    case "slide_left": s.opacity = lin; s.dx = (1 - p) * travel; break;
    case "slide_right": s.opacity = lin; s.dx = -(1 - p) * travel; break;
    case "pop": s.opacity = lin; s.sx = s.sy = 0.85 + 0.15 * p; break;
    case "grow_x": s.sx = Math.max(0.001, p); s.origin = "left"; s.opacity = t > at ? 1 : 0; break;
    case "grow_y": s.sy = Math.max(0.001, p); s.origin = "top"; s.opacity = t > at ? 1 : 0; break;
    case "words": s.words = t < at ? 0 : lin; break;
    case "none": break;
  }
  // Loops start once the element has entered, so entrances stay clean.
  const since = t - (at + duration);
  if (since > 0 && m.loop !== "none") {
    const w = Math.sin((since / 2.4) * Math.PI * 2);
    if (m.loop === "pulse") { s.sx *= 1 + 0.03 * w; s.sy *= 1 + 0.03 * w; }
    if (m.loop === "float") s.dy += w * width * 0.006;
    if (m.loop === "breathe") s.opacity *= 0.9 + 0.1 * (w + 1) / 2;
  }
  return s;
}

/** The illustration background's scale and offset (px) at t: a slow, linear drift over the whole clip. */
export function backgroundState(spec: MotionSpec | null | undefined, t: number, size: { width: number; height: number }) {
  if (!spec || spec.background.motion === "none") return { scale: 1, dx: 0, dy: 0 };
  const p = clamp(t / spec.durationS);
  const a = spec.background.amount;
  const scale = spec.background.motion === "zoom_out" ? 1 + a * (1 - p) : 1 + a * (spec.background.motion === "zoom_in" ? p : 1);
  const sweep = (2 * p - 1) * (a / 2);
  const dx = spec.background.motion === "pan_left" ? -sweep * size.width : spec.background.motion === "pan_right" ? sweep * size.width : 0;
  const dy = spec.background.motion === "pan_up" ? -sweep * size.height : spec.background.motion === "pan_down" ? sweep * size.height : 0;
  return { scale, dx, dy };
}

/** Checks a spec against a template's elements (indexes exist, entrances end before the clip does). */
export function specIssues(spec: MotionSpec, elementCount: number): string[] {
  const out: string[] = [];
  for (const e of spec.elements) {
    if (e.index >= elementCount) out.push(`elements: index ${e.index} does not exist (the template has ${elementCount} elements)`);
    if (e.enter.at + e.enter.duration > spec.durationS - 0.5) out.push(`elements[${e.index}]: enters until ${(e.enter.at + e.enter.duration).toFixed(1)} s; it must be in place 0.5 s before the end (${spec.durationS} s)`);
  }
  if (new Set(spec.elements.map((e) => e.index)).size !== spec.elements.length) out.push("elements: an index is listed twice");
  return out;
}
