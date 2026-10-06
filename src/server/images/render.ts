// Slide rendering (TASK-015, ADR-043): Satori lays the template out as SVG (text becomes vector paths in the brand's
// font, so č š ž are always exact), sharp/librsvg turns it into a PNG. No browser, no network.
import fs from "node:fs/promises";
import path from "node:path";
import satori from "satori";
import sharp from "sharp";
import { MAX_INPUT_PIXELS } from "../files/images";
import { slideTree, type BrandTemplate, type Colors, type Slide } from "./template";

type Font = { name: string; data: Buffer; weight: 700; style: "normal" };

// Fontsource Latin + Latin Extended subsets merged into one file each (Satori does not fall back between same-named fonts).
const FONT_FILES = { sans: ["Inter-Bold.woff"], mono: ["JetBrainsMono-Bold.woff"] } as const;

let builtins: Promise<Record<"sans" | "mono", Font[]>> | undefined;

/** Inter and JetBrains Mono Bold (OFL, assets/fonts), with č š ž ć đ. Read once per process. */
function builtinFonts() {
  builtins ??= (async () => {
    const dir = process.env.FONT_DIR ?? path.join(process.cwd(), "assets", "fonts");
    const load = async (files: readonly string[]) =>
      Promise.all(files.map(async (f) => ({ name: "Heading", data: await fs.readFile(path.join(dir, f)), weight: 700 as const, style: "normal" as const })));
    return { sans: await load(FONT_FILES.sans), mono: await load(FONT_FILES.mono) };
  })();
  return builtins;
}

export type RenderAssets = {
  /** TTF/OTF bytes of the brand's own font (checked at upload), used first; the built-in one fills missing glyphs. */
  brandFont?: Uint8Array | null;
  /** PNG of the brand logo. */
  logo?: Uint8Array | null;
  /** Background image bytes (JPEG/PNG), used on the cover (first slide). */
  background?: Uint8Array | null;
};

export type SlideText = { label: string | null; headline: string | null };

const dataUri = (bytes: Uint8Array, type: string) => `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;

/** Logo fitted into the footer (or the corner): at most 72 × 360 px at 1080 wide, aspect kept. */
async function fittedLogo(logo: Uint8Array, k: number) {
  const meta = await sharp(logo, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  const w0 = meta.width ?? 1, h0 = meta.height ?? 1;
  const scale = Math.min((72 * k) / h0, (360 * k) / w0);
  const width = Math.max(1, Math.round(w0 * scale)), height = Math.max(1, Math.round(h0 * scale));
  const png = await sharp(logo, { limitInputPixels: MAX_INPUT_PIXELS }).resize(width * 2, height * 2, { fit: "inside" }).png().toBuffer();
  return { src: dataUri(png, "image/png"), width, height };
}

/** Background cropped to the slide (cover) and re-encoded, so the SVG stays small. */
async function fittedBackground(bg: Uint8Array, width: number, height: number) {
  const jpg = await sharp(bg, { limitInputPixels: MAX_INPUT_PIXELS }).rotate().resize(width, height, { fit: "cover" }).jpeg({ quality: 88 }).toBuffer();
  return dataUri(jpg, "image/jpeg");
}

/**
 * Renders the slides of one post: the first gets the background (if any), the rest are text cards on the brand
 * colour (carousel cards, as in the owner's examples). Returns one PNG per slide.
 */
export async function renderSlides(tpl: BrandTemplate, colors: Colors, size: { width: number; height: number }, texts: SlideText[], assets: RenderAssets = {}): Promise<Uint8Array[]> {
  const k = size.width / 1080;
  const fonts = await builtinFonts();
  const mono = tpl.typeface === "mono";
  const fontList: Font[] = [
    ...(assets.brandFont ? [{ name: "Heading", data: Buffer.from(assets.brandFont), weight: 700 as const, style: "normal" as const }] : []),
    ...fonts[mono ? "mono" : "sans"],
  ];
  const logo = assets.logo ? await fittedLogo(assets.logo, k) : null;
  const background = assets.background && tpl.background === "ai" ? await fittedBackground(assets.background, size.width, size.height) : null;
  const out: Uint8Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    const slide: Slide = { ...size, background: i === 0 ? background : null, label: texts[i].label, headline: texts[i].headline, logo };
    const svg = await satori(slideTree(tpl, colors, slide, mono) as unknown as Parameters<typeof satori>[0], { width: size.width, height: size.height, fonts: fontList });
    const png = await sharp(Buffer.from(svg), { limitInputPixels: MAX_INPUT_PIXELS }).png({ compressionLevel: 8 }).toBuffer();
    out.push(new Uint8Array(png));
  }
  return out;
}
