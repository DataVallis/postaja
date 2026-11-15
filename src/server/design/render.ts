// Renders one template of a brand design (TASK-017, ADR-044): Satori lays it out as SVG — every letter is drawn by
// Postaja in the chosen font, so č š ž are exact — and sharp writes the PNG. No browser, no network.
import fs from "node:fs/promises";
import path from "node:path";
import satori from "satori";
import { backgroundState, elementState, type MotionSpec } from "../video/motion";
import sharp from "sharp";
import fontkit from "@pdf-lib/fontkit";
import { MAX_INPUT_PIXELS } from "../files/images";
import { fontRenderError } from "./font-check";
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
  /**
   * A partner's logo chosen for this post or ad (TASK-046): drawn next to the brand logo, sharing the template's logo
   * box; templates without a logo box get it in the bottom-right corner of the safe box.
   */
  partnerLogo?: Uint8Array | null;
  /**
   * The partner's name (TASK-047). A template that writes it as its own text — e.g. a co-branded footer "CHERR.IO |
   * Polygon" — gets the partner's logo in that text's place instead, and the brand logo stays alone.
   */
  partnerName?: string | null;
  /**
   * All the brand's logos, oldest first (TASK-062). When given, each template draws the one that stands out best from
   * the colour under its logo box (a navy logo on a navy slide was a single orange dot); `logo` is the fallback.
   */
  logos?: Uint8Array[] | null;
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
  /** One frame of an animation (TASK-023): every element and the illustration as they are at `t` seconds. */
  motion?: { spec: MotionSpec; t: number } | null;
  /** Reused across the frames of one animation: fitted pictures as data URIs (sharp is the slow part). */
  cache?: Map<string, string>;
};

type Node = { type: string; props: Record<string, unknown> };
const el = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node => ({ type, props: { style, children, ...extra } });
const dataUri = (b: Uint8Array, type: string) => `data:${type};base64,${Buffer.from(b).toString("base64")}`;
const rgba = (hex: string, a: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;

/** Width of a text in em (1 = the font size) for one family and weight; null when the font cannot measure it. */
export type Measure = (family: string, weight: number, text: string) => number | null;

type MeasuredFont = { unitsPerEm: number; layout: (text: string) => { advanceWidth: number } };

/**
 * Real glyph advances from the fonts Satori draws with (TASK-062), instead of a per-family average width: brand fonts
 * range from about 0.45 to 0.65 em per letter, so the average makes text either too small or too large for its box.
 */
export function fontMeasure(fonts: FontFace[]): Measure {
  const parsed = new Map<Buffer, MeasuredFont | null>();
  const widths = new Map<string, number | null>();
  return (family, weight, text) => {
    const key = `${family}|${weight}|${text}`;
    if (widths.has(key)) return widths.get(key)!;
    const face = fonts.find((f) => f.name === family && f.weight === weight) ?? fonts.find((f) => f.name === family);
    let out: number | null = null;
    if (face) {
      if (!parsed.has(face.data)) {
        try { parsed.set(face.data, fontkit.create(face.data) as unknown as MeasuredFont); } catch { parsed.set(face.data, null); }
      }
      const font = parsed.get(face.data);
      if (font) {
        try { out = font.layout(text).advanceWidth / font.unitsPerEm; } catch { out = null; }
      }
    }
    widths.set(key, out);
    return out;
  };
}

/**
 * Words that may not end a line: one-letter words (Slovenian prepositions and conjunctions "v z s k h a i o u", English
 * "a", "I") stay with the next word, so a line never ends in "h" or "v" (TASK-062).
 */
export function keepShortWords<T extends { word: string }>(words: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if ([...w.word].length === 1 && /\p{L}/u.test(w.word) && i + 1 < words.length) {
      out.push({ ...words[i + 1], word: `${w.word}\u00a0${words[i + 1].word}` });
      i++;
    } else out.push(w);
  }
  return out;
}

const luminance = (r: number, g: number, b: number) => {
  const c = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const hexLum = (hex: string) => luminance(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

type LogoLook = { lum: number; aspect: number };
const logoLooks = new WeakMap<Uint8Array, Promise<LogoLook | null>>();
/** A logo's visible colour (mean luminance of its opaque pixels) and the shape of its visible part. */
function logoLook(bytes: Uint8Array): Promise<LogoLook | null> {
  let p = logoLooks.get(bytes);
  if (!p) {
    p = (async () => {
      try {
        const trimmed = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).ensureAlpha().trim({ threshold: 1 }).toBuffer({ resolveWithObject: true }).catch(() => null);
        const src = trimmed ? trimmed.data : Buffer.from(bytes);
        const { data, info } = await sharp(src).ensureAlpha().resize({ width: 200, height: 200, fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
        let sum = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) { sum += luminance(data[i], data[i + 1], data[i + 2]); n++; }
        return n ? { lum: sum / n, aspect: trimmed ? trimmed.info.width / trimmed.info.height : info.width / info.height } : null;
      } catch { return null; }
    })();
    logoLooks.set(bytes, p);
  }
  return p;
}

/**
 * The logo that reads best on `bgHex` in a box of `boxAspect` (TASK-062): the highest contrast, then the one that fills
 * the box best; on a tie the first (oldest) upload. Logos that cannot be read are skipped.
 */
export async function pickLogo(logos: Uint8Array[], bgHex: string, boxAspect: number): Promise<Uint8Array | null> {
  const bg = hexLum(bgHex);
  let best: { bytes: Uint8Array; score: number } | null = null;
  for (const bytes of logos) {
    const look = await logoLook(bytes);
    if (!look) continue;
    const fill = Math.min(look.aspect, boxAspect) / Math.max(look.aspect, boxAspect); // share of the box it can fill
    const score = Math.log(contrast(look.lum, bg)) + 0.35 * Math.log(fill);
    if (!best || score > best.score + 1e-9) best = { bytes, score };
  }
  return best?.bytes ?? null;
}

/** The colour under a box: the last filled shape drawn below it that covers its centre, else the slide's background. */
export function colourUnder(spec: DesignSpec, t: Template, box: { x: number; y: number; w: number; h: number }, upTo: number): string {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  for (let i = upTo - 1; i >= 0; i--) {
    const e = t.elements[i];
    if (e.type === "shape" && e.opacity >= 0.5 && cx >= e.x && cx <= e.x + e.w && cy >= e.y && cy <= e.y + e.h) return color(spec, e.color);
  }
  if (t.background.type === "illustration") return t.background.overlay && t.background.overlay.opacity >= 0.5 ? color(spec, t.background.overlay.color) : spec.palette.background;
  return color(spec, t.background.color);
}

/**
 * Where a template's main text sits (headline, subhead, body, number, cta; labels and footers do not count), as the side
 * of the canvas it occupies and how far it reaches in % — or "all" when no side stays free (TASK-062).
 */
export type Box = { x: number; y: number; w: number; h: number };
const FULL: Box = { x: 0, y: 0, w: 100, h: 100 };

/**
 * `box` = where the picture is (the whole canvas for a full-bleed background, else the illustration element's box);
 * only main text drawn after `from` that overlaps it counts, measured in % of the box.
 */
export function textBand(t: Template, box: Box = FULL, from = 0): { side: "top" | "bottom" | "left" | "right"; edge: number } | { side: "all" } | null {
  const rel = t.elements.slice(from)
    .filter((e) => e.type === "text" && ["headline", "subhead", "body", "number", "cta"].includes(e.slot))
    .filter((e) => e.x < box.x + box.w && e.x + e.w > box.x && e.y < box.y + box.h && e.y + e.h > box.y)
    .map((e) => ({
      x: (Math.max(e.x, box.x) - box.x) / box.w * 100, y: (Math.max(e.y, box.y) - box.y) / box.h * 100,
      r: (Math.min(e.x + e.w, box.x + box.w) - box.x) / box.w * 100, b: (Math.min(e.y + e.h, box.y + box.h) - box.y) / box.h * 100,
    }));
  if (!rel.length) return null;
  const top = Math.min(...rel.map((e) => e.y)), bottom = Math.max(...rel.map((e) => e.b));
  const left = Math.min(...rel.map((e) => e.x)), right = Math.max(...rel.map((e) => e.r));
  if (bottom <= 72) return { side: "top", edge: bottom };
  if (top >= 28) return { side: "bottom", edge: top };
  if (right <= 66) return { side: "left", edge: right };
  if (left >= 34) return { side: "right", edge: left };
  return { side: "all" };
}

/**
 * Readability over a picture (TASK-062): image models draw the subject where they like, also under the text, whatever the
 * prompt says. A full-bleed picture without its own strong overlay, or an illustration element that main text is drawn
 * over (`picture`), gets a soft fade in the brand's background colour on the side where that text sits (a light even
 * veil when the text is everywhere).
 */
export function textScrim(t: Template, bgHex: string, picture?: { box: Box; index: number }): string | null {
  if (!picture && (t.background.type !== "illustration" || (t.background.overlay && t.background.overlay.opacity >= 0.5))) return null;
  const band = picture ? textBand(t, picture.box, picture.index + 1) : textBand(t);
  if (!band) return null;
  if (band.side === "all") return `linear-gradient(0deg, ${rgba(bgHex, 0.55)}, ${rgba(bgHex, 0.55)})`;
  const deg = { top: 180, bottom: 0, left: 90, right: 270 }[band.side];
  const reach = band.side === "top" || band.side === "left" ? band.edge : 100 - band.edge;
  const solid = Math.round(Math.max(0, reach - 6)), clear = Math.round(Math.min(100, reach + 16));
  return `linear-gradient(${deg}deg, ${rgba(bgHex, 0.9)} 0%, ${rgba(bgHex, 0.9)} ${solid}%, ${rgba(bgHex, 0)} ${clear}%)`;
}

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

/**
 * Largest size (px) between min and max at which the wrapped text fits the box. With `measure` (em width of a word, from
 * the font itself) the rows are laid out like Satori does — word, then a gap of (0.27 + letter spacing) em — with a 3 %
 * margin; without it, an average glyph width (`widthEm`) is the estimate. When even `min` does not fit, the size keeps
 * shrinking down to half of it: smaller text is better than text running into the next element (TASK-062: a design's
 * headline minimum of ~10 % left a five-row headline over the line below it).
 */
export function fitText(lines: string[][], boxW: number, boxH: number, o: { max: number; min: number; lineHeight: number; widthEm: number; letterSpacing: number; measure?: (word: string) => number | null }): number {
  const em = (w: string) => o.measure?.(w) ?? [...w].length * o.widthEm;
  const fits = (size: number) => {
    const gap = size * (0.27 + Math.max(0, o.letterSpacing));
    // A kept group ("h\u00a0konkurenci") is drawn as its words with the normal gap between them (textNode).
    const wordW = (w: string): number => {
      const parts = w.split("\u00a0");
      return parts.reduce((n, p) => n + (em(p) + [...p].length * o.letterSpacing) * size, 0) + gap * (parts.length - 1);
    };
    const width = boxW * (o.measure ? 0.97 : 1);
    let rows = 0;
    for (const words of lines) {
      let used = 0;
      rows++;
      for (const w of words) {
        const ww = wordW(w);
        if (ww > width * 1.02) return false; // a single word wider than the box
        if (used && used + gap + ww > width) { rows++; used = ww; } else used += (used ? gap : 0) + ww;
      }
    }
    return rows * size * o.lineHeight <= boxH;
  };
  for (let s = o.max; s > o.min; s *= 0.94) if (fits(s)) return Math.floor(s);
  for (let s = o.min; s > o.min * 0.5; s *= 0.94) if (fits(s)) return Math.floor(s);
  return Math.floor(o.min * 0.5);
}

function textNode(spec: DesignSpec, e: TextElement, value: string, W: number, H: number, ox = 0, oy = 0, wordsShown = 1, measure?: Measure): Node | null {
  if (!value.trim()) return null;
  const family = e.font === "heading" ? spec.typography.heading : spec.typography.body;
  const pad = (e.padding / 100) * W;
  const bw = (e.w / 100) * W, bh = (e.h / 100) * H;
  const lines = parseEmphasis(e.uppercase ? value.toUpperCase() : value).map(keepShortWords);
  const widthEm = (WIDTH[family] ?? 0.55) * (e.weight === 700 ? 1.06 : 1) * (e.uppercase ? 1.12 : 1);
  const size = fitText(lines.map((l) => l.map((w) => w.word)), bw - pad * 2, bh - pad * 2, {
    max: (e.maxSize / 100) * W, min: (Math.min(e.minSize, e.maxSize) / 100) * W, lineHeight: e.lineHeight, widthEm, letterSpacing: e.letterSpacing,
    measure: measure ? (word) => measure(family, e.weight, word) : undefined,
  });
  const gap = size * (0.27 + Math.max(0, e.letterSpacing));
  const justify = e.align === "center" ? "center" : e.align === "right" ? "flex-end" : "flex-start";
  // "words" entrance: the first share of words shows; the rest keep their place, invisible (no reflow while it plays).
  const total = lines.reduce((n, l) => n + l.length, 0);
  const visible = wordsShown >= 1 ? total : Math.floor(wordsShown * total + 1e-9);
  let k = 0;
  const rows = lines.map((words) =>
    el("div", { display: "flex", flexWrap: "wrap", justifyContent: justify, width: "100%" },
      words.map((w) => {
        const style = { color: color(spec, w.em && e.emphasis ? e.emphasis : e.color), marginRight: gap, ...(k++ >= visible ? { opacity: 0 } : {}) };
        const parts = w.word.split("\u00a0");
        // A kept group never breaks: one flex box of its words, spaced like any other words (no wide no-break space).
        return parts.length === 1 ? el("span", style, w.word)
          : el("span", { ...style, display: "flex" }, parts.map((p, i) => el("span", { marginRight: i < parts.length - 1 ? gap : 0 }, p)));
      })),
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

async function fitted(bytes: Uint8Array, w: number, h: number, fit: "cover" | "contain", png: boolean, cache?: Map<string, string>) {
  const key = cache ? `${bytes.byteLength}:${bytes[0]}:${bytes[bytes.byteLength >> 1]}:${Math.round(w)}x${Math.round(h)}:${fit}:${png}` : "";
  const hit = cache?.get(key);
  if (hit) return hit;
  const uri = await fittedUncached(bytes, w, h, fit, png);
  cache?.set(key, uri);
  return uri;
}

async function fittedUncached(bytes: Uint8Array, w: number, h: number, fit: "cover" | "contain", png: boolean) {
  const img = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).rotate().resize(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), { fit, background: { r: 0, g: 0, b: 0, alpha: 0 } });
  return png ? dataUri(await img.png().toBuffer(), "image/png") : dataUri(await img.jpeg({ quality: 88 }).toBuffer(), "image/jpeg");
}

const fold = (s: string) => s.replace(/\*/g, "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The text element that writes just the partner's name (optionally after "×", "&", "+", "with", "feat.", "s", "z",
 * "in"), or -1. Headlines that merely mention the partner never match.
 */
export function partnerTextIndex(t: Template, slots: Partial<Record<Slot, string>>, name: string): number {
  const n = fold(name);
  if (!n) return -1;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^(?:(?:×|&|\\+)\\s*|(?:x|with|feat\\.?|ft\\.?|s|z|in)\\s+)?${esc}[.!]?$`, "u");
  return t.elements.findIndex((e) => e.type === "text" && re.test(fold(e.slot === "static" ? e.text ?? "" : slots[e.slot] ?? "")));
}

/** A logo drawn where a line of text would be: as large as the box allows, aligned like the text. */
async function logoInText(bytes: Uint8Array, box: { x: number; y: number; w: number; h: number }, align: "left" | "center" | "right", valign: "top" | "middle" | "bottom", cache?: Map<string, string>): Promise<Node> {
  const meta = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  const scale = Math.min(box.w / (meta.width ?? 1), box.h / (meta.height ?? 1));
  const dw = Math.max(1, Math.round((meta.width ?? 1) * scale)), dh = Math.max(1, Math.round((meta.height ?? 1) * scale));
  return el("div", {
    position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, display: "flex",
    justifyContent: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
    alignItems: valign === "top" ? "flex-start" : valign === "bottom" ? "flex-end" : "center",
  }, [el("img", { width: dw, height: dh }, undefined, { src: await fitted(bytes, dw, dh, "contain", true, cache), width: dw, height: dh })]);
}

/**
 * The brand logo and a partner's logo in one box (TASK-046): side by side in a wide box, stacked in a tall one, each
 * scaled to fit its half with a gap between; the partner alone fills the box when the brand has no logo.
 */
async function logoPair(brand: Uint8Array | null, partner: Uint8Array, box: { x: number; y: number; w: number; h: number; opacity: number }, cache?: Map<string, string>): Promise<Node> {
  const row = box.w >= box.h;
  const gap = brand ? Math.round(Math.min(box.w, box.h) * 0.25) : 0;
  const pw = brand ? (row ? (box.w - gap) / 2 : box.w) : box.w;
  const ph = brand ? (row ? box.h : (box.h - gap) / 2) : box.h;
  const img = async (b: Uint8Array) => el("img", { width: pw, height: ph }, undefined, { src: await fitted(b, pw, ph, "contain", true, cache), width: pw, height: ph });
  const items = brand ? [await img(brand), await img(partner)] : [await img(partner)];
  return el("div", {
    position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, opacity: box.opacity,
    display: "flex", flexDirection: row ? "row" : "column", alignItems: "center", justifyContent: "center", gap,
  }, items);
}

/** One PNG of `template` at `size`. */
export async function renderTemplate(spec: DesignSpec, t: Template, size: { width: number; height: number }, input: RenderInput): Promise<Uint8Array> {
  const W = size.width, H = size.height;
  const usesBrand = spec.typography.heading === "brand" || spec.typography.body === "brand";
  // A brand font the renderer cannot read falls back to the built-in family instead of failing the image.
  const brandFont = usesBrand && input.brandFont && !(await fontRenderError(input.brandFont)) ? input.brandFont : null;
  const s: DesignSpec = usesBrand && !brandFont
    ? { ...spec, typography: { heading: spec.typography.heading === "brand" ? "sans" : spec.typography.heading, body: spec.typography.body === "brand" ? "sans" : spec.typography.body } }
    : spec;
  // Only the families this design uses (Satori parses every font it is given, on every render).
  const used = new Set<string>([s.typography.heading, s.typography.body]);
  const fonts = (await builtinFonts()).filter((f) => used.has(f.name) || f.name === "symbols");
  if (brandFont && used.has("brand")) for (const weight of [400, 700] as const) fonts.push({ name: "brand", data: Buffer.from(brandFont), weight, style: "normal" });
  const measure = fontMeasure(fonts);

  const b = t.background;
  const children: (Node | null)[] = [];
  const base: Record<string, unknown> = { display: "flex", position: "relative", width: W, height: H, backgroundColor: input.overlayOnly ? "transparent" : color(s, b.color) };
  if (b.type === "gradient" && !input.overlayOnly) base.backgroundImage = `linear-gradient(${b.angle}deg, ${color(s, b.color)}, ${color(s, b.to ?? "surface")})`;
  const picture = input.overlayOnly ? null : input.illustration ?? (t.background.type === "illustration" || t.elements.some((e) => e.type === "image" && e.source === "illustration") ? await standIn(s, W, H) : null);
  if (b.type === "illustration" && (picture || input.overlayOnly)) {
    if (!input.overlayOnly && picture) {
      const bg = backgroundState(input.motion?.spec, input.motion?.t ?? 0, { width: W, height: H });
      const move = bg.scale !== 1 || bg.dx || bg.dy ? { transform: `translate(${bg.dx}px, ${bg.dy}px) scale(${bg.scale})` } : {};
      children.push(el("img", { position: "absolute", left: 0, top: 0, width: W, height: H, ...move }, undefined, { src: await fitted(picture, W, H, "cover", false, input.cache), width: W, height: H }));
    }
    if (b.overlay) {
      const c = color(s, b.overlay.color), a = b.overlay.opacity;
      const grad = b.overlay.fade === "bottom" ? `linear-gradient(180deg, ${rgba(c, a * 0.15)} 0%, ${rgba(c, a)} 70%)`
        : b.overlay.fade === "top" ? `linear-gradient(0deg, ${rgba(c, a * 0.15)} 0%, ${rgba(c, a)} 70%)`
        : `linear-gradient(0deg, ${rgba(c, a)}, ${rgba(c, a)})`;
      children.push(el("div", { position: "absolute", left: 0, top: 0, width: W, height: H, backgroundImage: grad }));
    }
    const scrim = textScrim(t, s.palette.background);
    if (scrim) children.push(el("div", { position: "absolute", left: 0, top: 0, width: W, height: H, backgroundImage: scrim }));
  }
  // Elements live in the safe box (the whole canvas when no insets are given); sizes in % of the box.
  const ox = input.safe?.left ?? 0, oy = input.safe?.top ?? 0;
  const partnerSpot = input.partnerLogo && input.partnerName ? partnerTextIndex(t, input.slots, input.partnerName) : -1;
  const BW = W - ox - (input.safe?.right ?? 0), BH = H - oy - (input.safe?.bottom ?? 0);
  for (const [index, e] of t.elements.entries()) {
    const x = ox + (e.x / 100) * BW, y = oy + (e.y / 100) * BH, w = (e.w / 100) * BW, h = (e.h / 100) * BH;
    const st = input.motion ? elementState(input.motion.spec, index, input.motion.t, BW) : null;
    let node: Node | null = null;
    if (e.type === "shape") {
      node = el("div", {
        position: "absolute", left: x, top: y, width: w, height: h, backgroundColor: color(s, e.color), opacity: e.opacity,
        borderRadius: (e.radius / 100) * BW, ...(e.borderColor && e.borderWidth ? { border: `${(e.borderWidth * BW) / 1080}px solid ${color(s, e.borderColor)}` } : {}),
      });
    } else if (index === partnerSpot && e.type === "text") {
      node = await logoInText(input.partnerLogo!, { x, y, w, h }, e.align, e.valign, input.cache);
    } else if (e.type === "image" && e.source === "logo" && input.partnerLogo && partnerSpot < 0) {
      node = await logoPair(input.logo ?? null, input.partnerLogo, { x, y, w, h, opacity: e.opacity }, input.cache);
    } else if (e.type === "image") {
      const src = e.source === "logo"
        ? (input.logos?.length ? (await pickLogo(input.logos, colourUnder(s, t, e, index), (e.w * BW) / Math.max(1, e.h * BH))) ?? input.logo : input.logo)
        : picture;
      if (!src) continue;
      const img = el("img", { position: "absolute", left: x, top: y, width: w, height: h, borderRadius: (e.radius / 100) * BW, opacity: e.opacity }, undefined,
        { src: await fitted(src, w, h, e.source === "logo" ? "contain" : e.fit, e.source === "logo", input.cache), width: w, height: h });
      const scrim = e.source === "illustration" ? textScrim(t, s.palette.background, { box: e, index }) : null;
      // The picture and its fade move together in an animation: one box holding both.
      node = scrim
        ? el("div", { position: "absolute", left: x, top: y, width: w, height: h, display: "flex", opacity: e.opacity }, [
          el("img", { position: "absolute", left: 0, top: 0, width: w, height: h, borderRadius: (e.radius / 100) * BW }, undefined, { src: (img.props as { src: string }).src, width: w, height: h }),
          el("div", { position: "absolute", left: 0, top: 0, width: w, height: h, borderRadius: (e.radius / 100) * BW, backgroundImage: scrim }),
        ])
        : img;
    } else {
      const value = e.slot === "static" ? e.text ?? "" : input.slots[e.slot] ?? "";
      node = textNode(s, e, value, BW, BH, ox, oy, st?.words ?? 1, measure);
    }
    // Animation frame: the element's entrance/loop state on top of its own opacity (TASK-023).
    if (node && st) {
      const style = node.props.style as Record<string, unknown>;
      style.opacity = (typeof style.opacity === "number" ? style.opacity : 1) * st.opacity;
      if (st.dx || st.dy || st.sx !== 1 || st.sy !== 1) {
        style.transform = `translate(${st.dx}px, ${st.dy}px) scale(${st.sx}, ${st.sy})`;
        style.transformOrigin = st.origin === "left" ? "left center" : st.origin === "top" ? "center top" : "center center";
      }
    }
    children.push(node);
  }
  if (input.partnerLogo && partnerSpot < 0 && !t.elements.some((e) => e.type === "image" && e.source === "logo")) {
    children.push(await logoPair(null, input.partnerLogo, { x: ox + BW * 0.72, y: oy + BH * 0.88, w: BW * 0.24, h: BH * 0.08, opacity: 1 }, input.cache));
  }
  const svg = await satori(el("div", base, children.filter(Boolean)) as unknown as Parameters<typeof satori>[0], { width: W, height: H, fonts });
  return new Uint8Array(await sharp(Buffer.from(svg), { limitInputPixels: MAX_INPUT_PIXELS }).png({ compressionLevel: 6 }).toBuffer());
}
