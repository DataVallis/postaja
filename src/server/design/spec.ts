// A brand's visual system (TASK-017, ADR-044). Claude writes it per brand from the CGP, the owner's description,
// past posts and the logo; Postaja validates it here and renders it (render.ts). It is data, never code: positioned
// text, shapes and images on a canvas measured in percent, so one template works for 4:5, 1:1 and 16:9.
import { z } from "zod";

export const SLOTS = ["headline", "subhead", "label", "body", "cta", "number", "footer"] as const;
export type Slot = (typeof SLOTS)[number];
export const FAMILIES = ["sans", "grotesk", "serif", "mono"] as const;
export const PALETTE_KEYS = ["background", "surface", "text", "muted", "accent", "accent2"] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];

/** { headline?, subhead?, … } as plain optional properties (simpler for the tool's JSON schema than a record). */
export function slotTexts(max: number) {
  const v = z.string().max(max).optional();
  return z.object(Object.fromEntries(SLOTS.map((k) => [k, v])) as Record<Slot, typeof v>);
}
/** The same, where Claude may also answer null for an unused slot. */
export function nullableSlotTexts(max: number) {
  const v = z.string().max(max).nullable().optional();
  return z.object(Object.fromEntries(SLOTS.map((k) => [k, v])) as Record<Slot, typeof v>);
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** A palette key or an explicit #rrggbb. */
const colorRef = z.union([z.enum(PALETTE_KEYS), hex]);
const pct = z.number().min(0).max(100);
const box = { x: pct, y: pct, w: z.number().min(0.1).max(100), h: z.number().min(0.1).max(100) };

const textEl = z.object({
  type: z.literal("text"),
  ...box,
  /** Filled per post; "static" shows `text` as written (e.g. a website or a fixed tagline). */
  slot: z.enum([...SLOTS, "static"]),
  text: z.string().max(120).optional(),
  font: z.enum(["heading", "body"]).default("heading"),
  weight: z.union([z.literal(400), z.literal(700)]).default(700),
  color: colorRef,
  /** Words written as *this* in the slot are drawn in this colour. */
  emphasis: colorRef.optional(),
  /** Largest and smallest font size in percent of the canvas width; the text is fitted into its box between them. */
  maxSize: z.number().min(1).max(20),
  minSize: z.number().min(0.8).max(20).default(2.5),
  align: z.enum(["left", "center", "right"]).default("left"),
  valign: z.enum(["top", "middle", "bottom"]).default("top"),
  uppercase: z.boolean().default(false),
  lineHeight: z.number().min(0.8).max(2).default(1.1),
  /** em units, e.g. -0.02 tight, 0.15 spaced labels. */
  letterSpacing: z.number().min(-0.1).max(0.4).default(0),
  /** A chip behind the text (labels, CTA buttons). */
  fill: colorRef.optional(),
  padding: z.number().min(0).max(10).default(0),
  radius: z.number().min(0).max(50).default(0),
  opacity: z.number().min(0).max(1).default(1),
});

const shapeEl = z.object({
  type: z.literal("shape"),
  ...box,
  color: colorRef,
  opacity: z.number().min(0).max(1).default(1),
  /** Percent of the canvas width; 50 makes a circle of a square box. */
  radius: z.number().min(0).max(50).default(0),
  borderColor: colorRef.optional(),
  /** Pixels at 1080 wide. */
  borderWidth: z.number().min(0).max(40).default(0),
});

const imageEl = z.object({
  type: z.literal("image"),
  ...box,
  /** "illustration" = the post's generated picture; "logo" = the brand logo. */
  source: z.enum(["illustration", "logo"]),
  fit: z.enum(["cover", "contain"]).default("contain"),
  radius: z.number().min(0).max(50).default(0),
  opacity: z.number().min(0).max(1).default(1),
});

export const elementSchema = z.discriminatedUnion("type", [textEl, shapeEl, imageEl]);
export type Element = z.infer<typeof elementSchema>;
export type TextElement = z.infer<typeof textEl>;

export const templateSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().min(1).max(60),
  /** When Claude should pick it (e.g. "carousel cover with a strong claim"). */
  use: z.string().min(1).max(300),
  background: z.object({
    type: z.enum(["color", "gradient", "illustration"]),
    color: colorRef,
    to: colorRef.optional(),
    angle: z.number().min(0).max(360).default(180),
    /** Darkening/tint over a full-bleed illustration so text stays readable. */
    overlay: z.object({ color: colorRef, opacity: z.number().min(0).max(1), fade: z.enum(["none", "top", "bottom"]).default("none") }).optional(),
  }),
  elements: z.array(elementSchema).min(1).max(24),
  /** Example content for the preview, in the brand's language. */
  sample: slotTexts(400).default({}),
});
export type Template = z.infer<typeof templateSchema>;

export const designSpecSchema = z.object({
  /** The common thread: what makes every image of this brand recognisable. */
  summary: z.string().min(1).max(800),
  /** Style instructions for generated illustrations (medium, lighting, palette, mood, composition). */
  illustrationStyle: z.string().min(1).max(1000),
  palette: z.object({ background: hex, surface: hex, text: hex, muted: hex, accent: hex, accent2: hex.optional() }),
  typography: z.object({
    /** A built-in family or "brand" (the brand's uploaded font). */
    heading: z.enum([...FAMILIES, "brand"]),
    body: z.enum([...FAMILIES, "brand"]),
  }),
  templates: z.array(templateSchema).min(2).max(8),
}).superRefine((d, ctx) => {
  const ids = new Set<string>();
  for (const [i, t] of d.templates.entries()) {
    if (ids.has(t.id)) ctx.addIssue({ code: "custom", path: ["templates", i, "id"], message: "duplicate template id" });
    ids.add(t.id);
    if (!t.elements.some((e) => e.type === "text" && e.slot !== "static")) ctx.addIssue({ code: "custom", path: ["templates", i, "elements"], message: "a template needs at least one text slot" });
  }
});
export type DesignSpec = z.infer<typeof designSpecSchema>;

/** Resolves a palette key or hex to a hex colour. */
export function color(spec: Pick<DesignSpec, "palette">, ref: string): string {
  if (ref.startsWith("#")) return ref;
  return spec.palette[ref as PaletteKey] ?? spec.palette.accent;
}

/** Slots a template fills from the post (in drawing order, without duplicates). */
export function templateSlots(t: Template): Slot[] {
  const out: Slot[] = [];
  for (const e of t.elements) if (e.type === "text" && e.slot !== "static" && !out.includes(e.slot)) out.push(e.slot);
  return out;
}

/** Whether the template shows a generated illustration (full-bleed or framed). */
export function needsIllustration(t: Template): boolean {
  return t.background.type === "illustration" || t.elements.some((e) => e.type === "image" && e.source === "illustration");
}

/** JSON Schema for Claude's tool input (the same rules as the zod schema, minus cross-field checks). */
export function designJsonSchema(): Record<string, unknown> {
  const s = z.toJSONSchema(designSpecSchema, { target: "draft-2020-12", io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}
