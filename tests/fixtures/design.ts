// Sample brand designs (TASK-017) for tests and the E2E stand-in: shaped like what Claude returns.
import type { z } from "zod";
import type { designSpecSchema } from "../../src/server/design/spec";

type Input = z.input<typeof designSpecSchema>;

/** Dark card with a red label chip, a two-colour headline and a footer rule with the logo (CHERR.IO-like). */
export const cardDesign: Input = {
  summary: "Dark night-blue cards, one red accent, bold white headlines with the key words in red, a thin red rule above a logo footer.",
  illustrationStyle: "Moody product photography, deep blue shadows, single red rim light, no people, lots of negative space",
  palette: { background: "#0b0f1a", surface: "#161c2c", text: "#f5f3ee", muted: "#9aa3b5", accent: "#e0112b" },
  typography: { heading: "sans", body: "sans" },
  templates: [
    {
      id: "cover", name: "Naslovnica", use: "Single image or carousel cover with one strong claim",
      background: { type: "illustration", color: "background", overlay: { color: "background", opacity: 0.85, fade: "bottom" } },
      elements: [
        { type: "text", slot: "label", x: 7, y: 34, w: 60, h: 5, color: "text", fill: "accent", maxSize: 2.4, minSize: 1.6, padding: 1.2, letterSpacing: 0.18, uppercase: true },
        { type: "text", slot: "headline", x: 7, y: 41, w: 86, h: 36, color: "text", emphasis: "accent", maxSize: 9, minSize: 4, lineHeight: 1.05, letterSpacing: -0.02 },
        { type: "shape", x: 0, y: 84.5, w: 100, h: 0.3, color: "accent" },
        { type: "image", source: "logo", x: 7, y: 88, w: 24, h: 7 },
        { type: "text", slot: "footer", x: 36, y: 88, w: 57, h: 7, color: "text", font: "body", maxSize: 3.6, minSize: 2, valign: "middle" },
      ],
      sample: { label: "The problem", headline: "Daš. Zaklenjeno je.\n*Izplača se v korakih.*", footer: "Polygon" },
    },
    {
      id: "points", name: "Seznam", use: "Carousel inner slide with a short title and 2–4 points",
      background: { type: "color", color: "surface" },
      elements: [
        { type: "text", slot: "number", x: 7, y: 7, w: 20, h: 8, color: "accent", maxSize: 6, font: "heading" },
        { type: "text", slot: "headline", x: 7, y: 18, w: 86, h: 20, color: "text", emphasis: "accent", maxSize: 7, minSize: 3.5 },
        { type: "text", slot: "body", x: 7, y: 42, w: 86, h: 40, color: "muted", font: "body", weight: 400, maxSize: 4, minSize: 2.4, lineHeight: 1.35 },
        { type: "shape", x: 7, y: 90, w: 12, h: 0.6, color: "accent" },
      ],
      sample: { number: "02", headline: "Kako *deluje*", body: "Vplačaš enkrat.\nZnesek je zaklenjen.\nIzplačuje se po korakih." },
    },
  ],
};

/** Code-style centred cards on near-black with neon green (inzenirji.si-like). */
export const monoDesign: Input = {
  summary: "Near-black concrete, neon green accents, monospace centred statements like a terminal.",
  illustrationStyle: "Dark concrete texture, subtle neon green glow, construction details, cinematic",
  palette: { background: "#0e0f0e", surface: "#1a1c1a", text: "#e8ece8", muted: "#8a948a", accent: "#39ff14" },
  typography: { heading: "mono", body: "mono" },
  templates: [
    {
      id: "statement", name: "Izjava", use: "One short statement in the middle",
      background: { type: "illustration", color: "background", overlay: { color: "background", opacity: 0.8, fade: "none" } },
      elements: [
        { type: "text", slot: "headline", x: 8, y: 30, w: 84, h: 40, color: "text", emphasis: "accent", maxSize: 7, minSize: 3, align: "center", valign: "middle" },
        { type: "text", slot: "static", text: "inzenirji.si", x: 8, y: 88, w: 84, h: 5, color: "accent", maxSize: 2.6, align: "center", weight: 400 },
      ],
      sample: { headline: "Gradbeni dnevnik.\n*Digitalno.* Žig." },
    },
    {
      id: "code", name: "Koda", use: "Tips and checklists",
      background: { type: "gradient", color: "background", to: "surface", angle: 160 },
      elements: [
        { type: "text", slot: "label", x: 8, y: 8, w: 84, h: 5, color: "accent", maxSize: 2.6, weight: 400 },
        { type: "text", slot: "body", x: 8, y: 18, w: 84, h: 70, color: "text", maxSize: 4.2, minSize: 2.2, weight: 400, lineHeight: 1.4 },
      ],
      sample: { label: "$ nasvet", body: "> preveri statiko\n> zapiši v dnevnik\n> pošlji nadzoru" },
    },
  ],
};
