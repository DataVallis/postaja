// Renders one template of a brand design (TASK-017, ADR-044): Satori lays it out as SVG — every letter is drawn by
// Postaja in the chosen font, so č š ž are exact — and sharp writes the PNG. No browser, no network.
import fs from "node:fs/promises";
import path from "node:path";
import satori from "satori";
import sharp from "sharp";
import { MAX_INPUT_PIXELS } from "../files/images";
import { color, type DesignSpec, type Slot, type Template, type TextElement } from "./spec";

type FontFace = { name: string; data: Buffer; weight: 400 | 700; style: "normal" };
const FILES: Record<"sans" | "grotesk" | "serif" | "mono", [string, string]> = {
  sans: ["Inter-Regular.woff", "Inter-Bold.woff"],
  grotesk: ["SpaceGrotesk-Regular.woff", "SpaceGrotesk-Bold.woff"],
  serif: ["PlayfairDisplay-Regular.woff", "PlayfairDisplay-Bold.woff"],
  mono: ["JetBrainsMono-Regular.woff", "JetBrainsMono-Bold.woff"],
};
/** Average glyph width in em, for fitting text into its box before Satori lays it out. */
const WIDTH: Record<string, number> = { sans: 0.54, grotesk: 0.56, serif: 0.5, mono: 0.6, brand: 0.56 };

let builtins: Promise<FontFace[]> | undefined;
/** The four built-in families (OFL, assets/fonts) in regular and bold. Read once per process. */
function builtinFonts() {
  builtins ??= (async () => {
    const dir = process.env.FONT_DIR ?? path.join(process.cwd(), "assets", "fonts");
    const out: FontFace[] = [];
    for (const [name, [regular, bold]] of Object.entries(FILES)) {
      out.push({ name, data: await fs.readFile(path.join(dir, regular)), weight: 400, style: "normal" });
      out.push({ name, data: await fs.readFile(path.join(dir, bold)), weight: 700, style: "normal" });
    }
    // Fallback for ✓ ✗ → ★ ● ■ and other symbols the text families lack (Noto Sans Symbols 1+2, OFL).
    const symbols = await fs.readFile(path.join(dir, "NotoSansSymbols-Regular.woff"));
    out.push({ name: "symbols", data: symbols, weight: 400, style: "normal" }, { name: "symbols", data: symbols, weight: 700, style: "normal" });
    return out;
  })();
  return builtins;
}

export type RenderInput = {
  slots: Partial<Record<Slot, string>>;
  /** The post's generated picture (JPEG/PNG); a neutral stand-in is drawn when missing (previews). */
  illustration?: Uint8Array | null;
  logo?: Uint8Array | null;
  /** TTF/OTF of the brand font (used where the design says "brand"). */
  brandFont?: Uint8Array | null;
  /**
   * Pixels the platform's UI covers (a Story's top bar and reply field, TASK-021b). The background still fills the
   * whole canvas; every element is laid out in the box inside these insets, so no text or logo lands under the UI.
   */
  safe?: { top: number; right: number; bottom: number; left: number } | null;
  /**
   * Only what goes on top of an animated illustration (TASK-022): transparent canvas, no picture, no background colour;
   * the illustration's overlay (fade) and every element are drawn. Only for templates with a full-bleed illustration.
   */
  overlayOnly?: boolean;
};

type Node = { type: string; props: Record<string, unknown> };
const el = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node => ({ type, props: { style, children, ...extra } });
const dataUri = (b: Uint8Array, type: string) => `data:${type};base64,${Buffer.from(b).toString("base64")}`;
const rgba = (hex: string, a: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;

/** "Prvi *poudarjen* del" → words with an emphasis flag; explicit line breaks are kept as separate lines. */
export function parseEmphasis(text: string): { word: string; em: boolean }[][] {
  let em = false;
  return text.split(/\r?\n/).map((line) => {
    const words: { word: string; em: boolean }[] = [];
    for (const raw of line.split(/\s+/).filter(Boolean)) {
      let w = "";
      let wordEm = em;
      for (const ch of raw) {
        if (ch === "*") { em = !em; if (!w) wordEm = em; continue; }
        w += ch;
      }
      if (w) words.push({ word: w, em: wordEm || em });
    }
    return words;
  }).filter((l) => l.length);
}

/** Largest size (px) between min and max at which the wrapped text fits the box (estimate; Satori clips the rest). */
export function fitText(lines: string[][], boxW: number, boxH: number, o: { max: number; min: number; lineHeight: number; widthEm: number; letterSpacing: number }): number {
  const fits = (size: number) => {
    const charW = size * (o.widthEm + o.letterSpacing);
    let rows = 0;
    for (const words of lines) {
      let used = 0;
      rows++;
      for (const w of words) {
        const need = (w.length + (used ? 1 : 0)) * charW;
        if (used && used + need > boxW) { rows++; used = w.length * charW; } else used += need;
        if (w.length * charW > boxW * 1.02) return false; // a single word wider than the box
      }
    }
    return rows * size * o.lineHeight <= boxH;
  };
  for (let s = o.max; s > o.min; s *= 0.94) if (fits(s)) return Math.floor(s);
  return Math.floor(o.min);
}

function textNode(spec: DesignSpec, e: TextElement, value: string, W: number, H: number, ox = 0, oy = 0): Node | null {
  if (!value.trim()) return null;
  const family = e.font === "heading" ? spec.typography.heading : spec.typography.body;
  const pad = (e.padding / 100) * W;
  const bw = (e.w / 100) * W, bh = (e.h / 100) * H;
  const lines = parseEmphasis(e.uppercase ? value.toUpperCase() : value);
  const widthEm = (WIDTH[family] ?? 0.55) * (e.weight === 700 ? 1.06 : 1) * (e.uppercase ? 1.12 : 1);
  const size = fitText(lines.map((l) => l.map((w) => w.word)), bw - pad * 2, bh - pad * 2, {
    max: (e.maxSize / 100) * W, min: (Math.min(e.minSize, e.maxSize) / 100) * W, lineHeight: e.lineHeight, widthEm, letterSpacing: e.letterSpacing,
  });
  const gap = size * (0.27 + Math.max(0, e.letterSpacing));
  const justify = e.align === "center" ? "center" : e.align === "right" ? "flex-end" : "flex-start";
  const rows = lines.map((words) =>
    el("div", { display: "flex", flexWrap: "wrap", justifyContent: justify, width: "100%" },
      words.map((w) => el("span", { color: color(spec, w.em && e.emphasis ? e.emphasis : e.color), marginRight: gap }, w.word))),
  );
  const inner = el("div", {
    display: "flex", flexDirection: "column", maxWidth: "100%",
    fontFamily: `${family}, symbols`, fontWeight: e.weight, fontSize: size, lineHeight: e.lineHeight, letterSpacing: `${e.letterSpacing}em`,
    ...(e.fill ? { backgroundColor: color(spec, e.fill), padding: pad, borderRadius: (e.radius / 100) * W, paddingRight: Math.max(0, pad - gap) } : {}),
  }, rows);
  return el("div", {
    position: "absolute", left: ox + (e.x / 100) * W, top: oy + (e.y / 100) * H, width: bw, height: bh, display: "flex", flexDirection: "column",
    // No overflow:hidden here or on the canvas: Satori turns it into SVG masks that make librsvg ~10× slower. fitText
    // keeps text inside its box; the canvas edge clips anyway.
    justifyContent: e.valign === "middle" ? "center" : e.valign === "bottom" ? "flex-end" : "flex-start", alignItems: justify, opacity: e.opacity,
  }, [inner]);
}

/** A neutral picture in the brand's colours where the illustration will go (previews). */
async function standIn(spec: DesignSpec, w: number, h: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${spec.palette.surface}"/><stop offset="1" stop-color="${spec.palette.accent}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * 0.7}" cy="${h * 0.35}" r="${Math.min(w, h) * 0.22}" fill="${spec.palette.background}" opacity="0.35"/><rect x="${w * 0.12}" y="${h * 0.58}" width="${w * 0.46}" height="${h * 0.22}" rx="${w * 0.02}" fill="${spec.palette.text}" opacity="0.18"/></svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer());
}

async function fitted(bytes: Uint8Array, w: number, h: number, fit: "cover" | "contain", png: boolean) {
  const img = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).rotate().resize(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), { fit, background: { r: 0, g: 0, b: 0, alpha: 0 } });
  return png ? dataUri(await img.png().toBuffer(), "image/png") : dataUri(await img.jpeg({ quality: 88 }).toBuffer(), "image/jpeg");
}

/** One PNG of `template` at `size`. */
export async function renderTemplate(spec: DesignSpec, t: Template, size: { width: number; height: number }, input: RenderInput): Promise<Uint8Array> {
  const W = size.width, H = size.height;
  const usesBrand = spec.typography.heading === "brand" || spec.typography.body === "brand";
  const s: DesignSpec = usesBrand && !input.brandFont
    ? { ...spec, typography: { heading: spec.typography.heading === "brand" ? "sans" : spec.typography.heading, body: spec.typography.body === "brand" ? "sans" : spec.typography.body } }
    : spec;
  // Only the families this design uses (Satori parses every font it is given, on every render).
  const used = new Set<string>([s.typography.heading, s.typography.body]);
  const fonts = (await builtinFonts()).filter((f) => used.has(f.name) || f.name === "symbols");
  if (input.brandFont && used.has("brand")) for (const weight of [400, 700] as const) fonts.push({ name: "brand", data: Buffer.from(input.brandFont), weight, style: "normal" });

  const b = t.background;
  const children: (Node | null)[] = [];
  const base: Record<string, unknown> = { display: "flex", position: "relative", width: W, height: H, backgroundColor: input.overlayOnly ? "transparent" : color(s, b.color) };
  if (b.type === "gradient" && !input.overlayOnly) base.backgroundImage = `linear-gradient(${b.angle}deg, ${color(s, b.color)}, ${color(s, b.to ?? "surface")})`;
  const picture = input.overlayOnly ? null : input.illustration ?? (t.background.type === "illustration" || t.elements.some((e) => e.type === "image" && e.source === "illustration") ? await standIn(s, W, H) : null);
  if (b.type === "illustration" && (picture || input.overlayOnly)) {
    if (!input.overlayOnly && picture) children.push(el("img", { position: "absolute", left: 0, top: 0, width: W, height: H }, undefined, { src: await fitted(picture, W, H, "cover", false), width: W, height: H }));
    if (b.overlay) {
      const c = color(s, b.overlay.color), a = b.overlay.opacity;
      const grad = b.overlay.fade === "bottom" ? `linear-gradient(180deg, ${rgba(c, a * 0.15)} 0%, ${rgba(c, a)} 70%)`
        : b.overlay.fade === "top" ? `linear-gradient(0deg, ${rgba(c, a * 0.15)} 0%, ${rgba(c, a)} 70%)`
        : `linear-gradient(0deg, ${rgba(c, a)}, ${rgba(c, a)})`;
      children.push(el("div", { position: "absolute", left: 0, top: 0, width: W, height: H, backgroundImage: grad }));
    }
  }
  // Elements live in the safe box (the whole canvas when no insets are given); sizes in % of the box.
  const ox = input.safe?.left ?? 0, oy = input.safe?.top ?? 0;
  const BW = W - ox - (input.safe?.right ?? 0), BH = H - oy - (input.safe?.bottom ?? 0);
  for (const e of t.elements) {
    const x = ox + (e.x / 100) * BW, y = oy + (e.y / 100) * BH, w = (e.w / 100) * BW, h = (e.h / 100) * BH;
    if (e.type === "shape") {
      children.push(el("div", {
        position: "absolute", left: x, top: y, width: w, height: h, backgroundColor: color(s, e.color), opacity: e.opacity,
        borderRadius: (e.radius / 100) * BW, ...(e.borderColor && e.borderWidth ? { border: `${(e.borderWidth * BW) / 1080}px solid ${color(s, e.borderColor)}` } : {}),
      }));
    } else if (e.type === "image") {
      const src = e.source === "logo" ? input.logo : picture;
      if (!src) continue;
      children.push(el("img", { position: "absolute", left: x, top: y, width: w, height: h, borderRadius: (e.radius / 100) * BW, opacity: e.opacity }, undefined,
        { src: await fitted(src, w, h, e.source === "logo" ? "contain" : e.fit, e.source === "logo"), width: w, height: h }));
    } else {
      const value = e.slot === "static" ? e.text ?? "" : input.slots[e.slot] ?? "";
      children.push(textNode(s, e, value, BW, BH, ox, oy));
    }
  }
  const svg = await satori(el("div", base, children.filter(Boolean)) as unknown as Parameters<typeof satori>[0], { width: W, height: H, fonts });
  return new Uint8Array(await sharp(Buffer.from(svg), { limitInputPixels: MAX_INPUT_PIXELS }).png({ compressionLevel: 6 }).toBuffer());
}
