// A screen shown as it is (owner, 2026-10-15: four corrections with the image model never put his app screenshot into
// the phone; a plain edit in the Claude app did it at once). When a correction asks for an owner's picture on a phone,
// tablet or computer screen that is already in the illustration, nothing is drawn: Claude finds the screen's four
// corners, Postaja warps the picture exactly into them (perspective, rounded corners) and Claude looks at the result —
// corners corrected up to twice. No image model, no credits: the screenshot stays pixel for pixel.
import sharp from "sharp";
import type { Db } from "../db/client";
import { toBlock } from "../design/service";
import { MAX_INPUT_PIXELS } from "../files/images";
import { cappedCall } from "../llm/call";
import type { LlmClient } from "../llm/types";
import type { OrgContext } from "../tenancy/context";

export type Point = { x: number; y: number };
/** Corners of the screen in the illustration's pixels: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

// ---- geometry ------------------------------------------------------------------------------------------------------

/** The 3×3 homography (h33 = 1) mapping the four `from` points onto the four `to` points. */
export function homography(from: Quad, to: Quad): number[] {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    [b[c], b[p]] = [b[p], b[c]];
    if (Math.abs(a[c][c]) < 1e-12) throw new Error("DEGENERATE_QUAD");
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let k = c; k < 8; k++) a[r][k] -= f * a[c][k];
      b[r] -= f * b[c];
    }
  }
  return [...b.map((v, i) => v / a[i][i]), 1];
}

const apply = (h: number[], x: number, y: number): Point => {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
};

/** A plausible screen: convex, not tiny, inside the picture. */
export function validQuad(q: Quad, width: number, height: number): boolean {
  if (q.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < -2 || p.y < -2 || p.x > width + 2 || p.y > height + 2)) return false;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const signs = q.map((_, i) => Math.sign(cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4])));
  if (!signs.every((s) => s === signs[0] && s !== 0)) return false;
  const area = Math.abs(q.reduce((s, p, i) => s + p.x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * p.y, 0)) / 2;
  return area >= 0.004 * width * height;
}

/**
 * `picture` warped into `quad` on top of `base` (both decoded by sharp; the result is a JPEG of base's size). The
 * picture fills the quad (cover, centred), with rounded corners of `radius` × its width, anti-aliased edges.
 */
export async function warpInto(base: Uint8Array, picture: Uint8Array, quad: Quad, radius = 0.06): Promise<Uint8Array> {
  const bg = sharp(base, { limitInputPixels: MAX_INPUT_PIXELS }).removeAlpha();
  const { width: W, height: H } = await bg.metadata();
  if (!W || !H) throw new Error("BAD_BASE");
  // The picture cut to the screen's proportions (cover): the screen's average width and height.
  const len = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const sw = (len(quad[0], quad[1]) + len(quad[3], quad[2])) / 2;
  const sh = (len(quad[0], quad[3]) + len(quad[1], quad[2])) / 2;
  const scale = Math.min(2, Math.max(1, 1600 / Math.max(sw, sh)));
  const pw = Math.max(8, Math.round(sw * scale)), ph = Math.max(8, Math.round(sh * scale));
  const src = await sharp(picture, { limitInputPixels: MAX_INPUT_PIXELS }).flatten({ background: "#ffffff" }).resize(pw, ph, { fit: "cover", position: "centre" }).raw().toBuffer();
  const minX = Math.max(0, Math.floor(Math.min(...quad.map((p) => p.x)))), maxX = Math.min(W - 1, Math.ceil(Math.max(...quad.map((p) => p.x))));
  const minY = Math.max(0, Math.floor(Math.min(...quad.map((p) => p.y)))), maxY = Math.min(H - 1, Math.ceil(Math.max(...quad.map((p) => p.y))));
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  // Each output pixel looks back into the picture (inverse map), bilinear; coverage with 2×2 supersampling for edges.
  const inv = homography(quad, [{ x: 0, y: 0 }, { x: pw, y: 0 }, { x: pw, y: ph }, { x: 0, y: ph }]);
  const r = radius * pw;
  const inside = (u: number, v: number) => {
    if (u < 0 || v < 0 || u > pw || v > ph) return false;
    const cx = u < r ? r : u > pw - r ? pw - r : u, cy = v < r ? r : v > ph - r ? ph - r : v;
    return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
  };
  const out = Buffer.alloc(bw * bh * 4);
  const sample = (u: number, v: number, c: number) => {
    const x = Math.min(pw - 1.001, Math.max(0, u - 0.5)), y = Math.min(ph - 1.001, Math.max(0, v - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const at = (xx: number, yy: number) => src[(yy * pw + xx) * 3 + c];
    return at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
  };
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let hits = 0;
      for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const q = apply(inv, minX + x + dx, minY + y + dy);
        if (inside(q.x, q.y)) hits++;
      }
      if (!hits) continue;
      const c = apply(inv, minX + x + 0.5, minY + y + 0.5);
      const o = (y * bw + x) * 4;
      for (let k = 0; k < 3; k++) out[o + k] = Math.round(sample(c.x, c.y, k));
      out[o + 3] = Math.round((hits / 4) * 255);
    }
  }
  const layer = await sharp(out, { raw: { width: bw, height: bh, channels: 4 } }).png().toBuffer();
  return new Uint8Array(await bg.composite([{ input: layer, left: minX, top: minY }]).jpeg({ quality: 92 }).toBuffer());
}

// ---- the whole picture ---------------------------------------------------------------------------------------------

/**
 * The owner's picture as the whole illustration, at `width` × `height` (owner, 2026-10-15: "the phone picture must cover
 * all of it" — his screenshot was already a phone mockup). Close proportions are filled (cover); otherwise the picture
 * is shown whole on its own edge colour, so nothing of it is cut away.
 */
export async function wholePicture(picture: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const img = sharp(picture, { limitInputPixels: MAX_INPUT_PIXELS }).flatten({ background: "#ffffff" });
  const { width: pw = 1, height: ph = 1 } = await img.metadata();
  const close = Math.abs(Math.log((pw / ph) / (width / height))) < 0.12;
  if (close) return new Uint8Array(await img.resize(width, height, { fit: "cover", position: "centre" }).jpeg({ quality: 92 }).toBuffer());
  // The edge colour: the average of the picture's outer ring (a mockup's background).
  const n = 16;
  const { data } = await sharp(picture, { limitInputPixels: MAX_INPUT_PIXELS }).flatten({ background: "#ffffff" }).resize(n, n, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  let count = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (x > 0 && y > 0 && x < n - 1 && y < n - 1) continue;
    for (let c = 0; c < 3; c++) sum[c] += data[(y * n + x) * 3 + c];
    count++;
  }
  const [r, g, b] = sum.map((v) => Math.round(v / count));
  return new Uint8Array(await sharp(picture, { limitInputPixels: MAX_INPUT_PIXELS }).flatten({ background: "#ffffff" })
    .resize(width, height, { fit: "contain", background: { r, g, b } }).jpeg({ quality: 92 }).toBuffer());
}

// ---- Claude finds and checks the screen ----------------------------------------------------------------------------

const VIEW = 1000;
const quadSchema = {
  type: "object",
  properties: {
    use: {
      type: "string", enum: ["screen", "whole", "none"],
      description: "screen = put the owner's picture onto a phone/tablet/computer screen inside the picture; whole = the owner's picture replaces the whole picture (the owner asks for it to fill or replace the picture, or it already shows a device or mockup itself — never a phone inside a phone); none = neither fits.",
    },
    corners: {
      type: "array", minItems: 4, maxItems: 4, description: "Only for use=screen: the screen's visible display area (inside the bezel, all of the glass), in pixels of the image shown — read them off the grid: top-left, top-right, bottom-right, bottom-left.",
      items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"], additionalProperties: false },
    },
    ok: { type: "boolean", description: "Only when checking a result: the picture covers the whole display exactly — nothing of the old screen visible anywhere around it, nothing over the bezel." },
  },
  required: ["use"],
  additionalProperties: false,
} as const;

type Who = { orgId: string; brandId: string | null; postId: string | null; now?: Date };

/** A coordinate grid (every 50 px, numbered every 100) over a picture, so Claude reads corners off it instead of guessing. */
async function withGrid(jpeg: Uint8Array, w: number, h: number, offset = { x: 0, y: 0 }, scale = 1): Promise<Uint8Array> {
  const lines: string[] = [];
  const step = 50;
  const first = (o: number) => Math.ceil(o / step) * step;
  for (let v = first(offset.x); v <= offset.x + w / scale; v += step) {
    const x = (v - offset.x) * scale;
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${v % 100 ? "#ff00ff" : "#ff0000"}" stroke-opacity="${v % 100 ? 0.35 : 0.6}" stroke-width="1"/>`);
    if (v % 100 === 0) lines.push(`<text x="${x + 2}" y="12" font-size="11" font-family="sans-serif" fill="#ff0000" stroke="#ffffff" stroke-width="2" paint-order="stroke">${v}</text>`);
  }
  for (let v = first(offset.y); v <= offset.y + h / scale; v += step) {
    const y = (v - offset.y) * scale;
    lines.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${v % 100 ? "#ff00ff" : "#ff0000"}" stroke-opacity="${v % 100 ? 0.35 : 0.6}" stroke-width="1"/>`);
    if (v % 100 === 0) lines.push(`<text x="2" y="${y - 2}" font-size="11" font-family="sans-serif" fill="#ff0000" stroke="#ffffff" stroke-width="2" paint-order="stroke">${v}</text>`);
  }
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${lines.join("")}</svg>`);
  return new Uint8Array(await sharp(jpeg).composite([{ input: svg, left: 0, top: 0 }]).jpeg({ quality: 85 }).toBuffer());
}

async function view(jpeg: Uint8Array) {
  const img = sharp(jpeg, { limitInputPixels: MAX_INPUT_PIXELS });
  const { width = 1, height = 1 } = await img.metadata();
  const k = VIEW / Math.max(width, height);
  const sw = Math.round(width * k), sh = Math.round(height * k);
  const plain = new Uint8Array(await img.resize(sw, sh).jpeg({ quality: 85 }).toBuffer());
  return { plain, small: await withGrid(plain, sw, sh), k, width, height, sw, sh };
}

/** The screen's area enlarged (with the same grid numbers), so Claude sees the edges. */
async function closeUp(v: Awaited<ReturnType<typeof view>>, q: Quad): Promise<Uint8Array> {
  const xs = q.map((p) => p.x * v.k), ys = q.map((p) => p.y * v.k);
  const m = 0.12 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const left = Math.max(0, Math.floor(Math.min(...xs) - m)), top = Math.max(0, Math.floor(Math.min(...ys) - m));
  const w = Math.min(v.sw - left, Math.ceil(Math.max(...xs) + m) - left), h = Math.min(v.sh - top, Math.ceil(Math.max(...ys) + m) - top);
  const scale = Math.min(3, 900 / Math.max(w, h));
  const big = new Uint8Array(await sharp(v.plain).extract({ left, top, width: Math.max(1, w), height: Math.max(1, h) }).resize(Math.round(w * scale), Math.round(h * scale)).jpeg({ quality: 88 }).toBuffer());
  return withGrid(big, Math.round(w * scale), Math.round(h * scale), { x: left, y: top }, scale);
}

const toQuad = (c: unknown, k: number): Quad | null => {
  if (!Array.isArray(c) || c.length !== 4) return null;
  const q = c.map((p) => ({ x: Number((p as Point).x) / k, y: Number((p as Point).y) / k }));
  return q.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ? (q as Quad) : null;
};

const choiceOf = (a: { use?: unknown; found?: unknown } | null) => (a?.use === "screen" || a?.use === "whole" ? a.use : a?.found === true ? "screen" : "none");

export type Placed = { bytes: Uint8Array; how: "screen" | "whole" };

/**
 * Puts `picture` into `illustration`: on the screen in it (Claude finds the screen on a grid, Postaja warps the picture
 * in, Claude checks a close-up and corrects the corners at most twice), or as the whole picture when that is what the
 * owner asks for or the picture already shows a device. Null when neither fits (the caller then edits with the model).
 */
export async function placeOnScreen(db: Db, llm: LlmClient, ctx: Pick<OrgContext, "orgId">, who: Omit<Who, "orgId">, illustration: Uint8Array, picture: Uint8Array, request: string): Promise<Placed | null> {
  const base = await view(illustration);
  const call = (user: string, images: { small: Uint8Array; caption: string }[]) => cappedCall(db, llm, { ...who, orgId: ctx.orgId, action: "assist" }, {
    system: [{ text: "You place an owner's picture (usually an app screenshot) into a picture that is already made. A red grid with numbers is drawn over the images so you can read exact pixel coordinates (origin top-left); the grid is not part of the picture.", cache: true }],
    user,
    images: images.map((i) => ({ ...toBlock(i.small), caption: i.caption })),
    tool: { name: "screen_corners", description: "Where the owner's picture goes.", inputSchema: quadSchema as unknown as Record<string, unknown> },
    maxTokens: 500,
  });
  const pic = new Uint8Array(await sharp(picture).resize(400, 400, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer());
  const first = await call(
    `The owner asked: "${request.slice(0, 600)}"\nThe first image (${base.sw}×${base.sh} px) is the current picture; the second is the owner's picture.\n` +
      `Decide: "whole" when the owner wants his picture to fill or replace the picture (e.g. "over all of it", "replace the picture", "the whole image"), or when his picture already shows a phone, device or mockup itself — putting it on a screen would give a device inside a device. "screen" when a phone, tablet or computer screen in the picture should show his picture: then give the four corners of the screen's whole display area (inside the bezel, all of the glass, nothing of the old screen left out), top-left, top-right, bottom-right, bottom-left, read off the grid in pixels of the first image. "none" when neither fits.`,
    [{ small: base.small, caption: "The current picture (with grid):" }, { small: pic, caption: "The owner's picture:" }],
  );
  const a = first.input as { use?: unknown; found?: unknown; corners?: unknown } | null;
  const use = choiceOf(a);
  if (use === "whole") return { bytes: await wholePicture(picture, base.width, base.height), how: "whole" };
  let quad = use === "screen" ? toQuad(a?.corners, base.k) : null;
  if (!quad || !validQuad(quad, base.width, base.height)) return null;
  let result = await warpInto(illustration, picture, quad);
  // Look at the result (whole and close up) and correct the corners (twice at most).
  for (let round = 0; round < 2; round++) {
    const shown = await view(result);
    const check = await call(
      `This is the picture after the owner's picture was placed at the corners you gave (${quad.map((p) => `${Math.round(p.x * base.k)},${Math.round(p.y * base.k)}`).join(" · ")}); the second image is a close-up with the same grid numbers. Does it cover the screen's whole display exactly — no strip of the old screen visible above, below or beside it, nothing over the device's frame? If yes, use="screen" and ok=true. If not, use="screen", ok=false and corrected corners of the whole display area (same order, pixels of the first image, read off the grid).`,
      [{ small: shown.small, caption: "After placing (with grid):" }, { small: await closeUp(shown, quad), caption: "Close-up of the screen (same grid numbers):" }],
    );
    const c = check.input as { ok?: boolean; corners?: unknown } | null;
    if (c?.ok !== false) break;
    const next = toQuad(c.corners, base.k);
    if (!next || !validQuad(next, base.width, base.height)) break;
    quad = next;
    result = await warpInto(illustration, picture, quad);
  }
  return { bytes: result, how: "screen" };
}
