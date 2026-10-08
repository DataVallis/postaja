// What a demo takes from a prospect's public home page (TASK-040): readable text (htmlToText), the logo, a few pictures
// and the colours the page uses. Plain code, no parser dependency; links are resolved against the page and only
// http(s) addresses are kept. Everything here is data for Claude and the brand's files, never instructions.
import { decodeEntities, htmlToText } from "../competitors/html";

export const IMAGES_MAX = 4;

export type SiteFacts = { title: string; text: string; logoUrl: string | null; imageUrls: string[]; colors: string[] };

const attr = (tag: string, name: string) => {
  const v = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(2).find((x) => x !== undefined);
  return v === undefined ? undefined : decodeEntities(v).trim();
};

/** An absolute http(s) URL for `ref` on `base`, or null (data:, javascript:, broken links). */
export function resolveUrl(ref: string | undefined, base: string): string | null {
  if (!ref) return null;
  try {
    const u = new URL(ref, base);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** First URL of a srcset ("a.jpg 1x, b.jpg 2x" → the largest). */
function fromSrcset(srcset: string | undefined): string | undefined {
  if (!srcset) return undefined;
  const items = srcset.split(",").map((s) => s.trim().split(/\s+/)).filter((p) => p[0]);
  const score = (d?: string) => (d ? parseFloat(d) || 0 : 0);
  return items.sort((a, b) => score(b[1]) - score(a[1]))[0]?.[0];
}

const LOGO_RE = /logo|brand|znak/i;
const SKIP_RE = /sprite|pixel|tracking|spacer|blank|icon-|favicon|avatar|emoji|placeholder|loader|\.gif(\?|$)/i;
const RASTER_RE = /\.(png|jpe?g|webp|svg)(\?|$)/i;

/** The home page's text, logo, up to IMAGES_MAX pictures and its most used colours (hex). */
export function readSite(html: string, pageUrl: string): SiteFacts {
  const h = html.slice(0, 3_000_000);
  const { title, text } = htmlToText(h);
  const head = /<head\b[\s\S]*?<\/head>/i.exec(h)?.[0] ?? "";
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const meta = (key: string) => metas.find((m) => new RegExp(`(?:name|property)\\s*=\\s*["']${key}["']`, "i").test(m));
  const ogImage = resolveUrl(attr(meta("og:image") ?? "", "content"), pageUrl);

  // Logo: an <img> that says "logo" (src, alt, class or id, or inside a link/element named so), else the touch icon.
  const imgs = [...h.matchAll(/<img\b[^>]*>/gi)].map((m) => ({ tag: m[0], at: m.index ?? 0 }));
  let logoUrl: string | null = null;
  for (const { tag, at } of imgs) {
    const src = attr(tag, "src") ?? fromSrcset(attr(tag, "srcset"));
    const near = h.slice(Math.max(0, at - 200), at);
    const named = [attr(tag, "alt"), attr(tag, "class"), attr(tag, "id"), src].some((v) => v && LOGO_RE.test(v)) || /class\s*=\s*["'][^"']*logo/i.test(near);
    const url = named ? resolveUrl(src, pageUrl) : null;
    if (url && RASTER_RE.test(new URL(url).pathname)) { logoUrl = url; break; }
  }
  if (!logoUrl) {
    const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    const touch = links.find((l) => /rel\s*=\s*["'][^"']*apple-touch-icon/i.test(l));
    const icon = links.find((l) => /rel\s*=\s*["'][^"']*\bicon\b/i.test(l) && /\.(png|svg)(\?|$)/i.test(attr(l, "href") ?? ""));
    logoUrl = resolveUrl(attr(touch ?? icon ?? "", "href"), pageUrl);
  }

  // Pictures: og:image first, then large content images (not the logo, not icons/trackers), each once.
  const imageUrls: string[] = [];
  const add = (u: string | null) => { if (u && u !== logoUrl && !imageUrls.includes(u) && imageUrls.length < IMAGES_MAX) imageUrls.push(u); };
  add(ogImage);
  for (const { tag } of imgs) {
    const src = fromSrcset(attr(tag, "srcset")) ?? attr(tag, "src") ?? attr(tag, "data-src");
    const url = resolveUrl(src, pageUrl);
    if (!url || SKIP_RE.test(url) || LOGO_RE.test(attr(tag, "alt") ?? "") || LOGO_RE.test(url)) continue;
    if (!/\.(png|jpe?g|webp)(\?|$)/i.test(new URL(url).pathname)) continue;
    const w = Number(attr(tag, "width") ?? 0), hgt = Number(attr(tag, "height") ?? 0);
    if ((w && w < 200) || (hgt && hgt < 150)) continue;
    add(url);
  }

  // Colours: theme-color first, then the hex colours the page's own CSS uses most (not black, white or greys).
  const counts = new Map<string, number>();
  const theme = attr(meta("theme-color") ?? "", "content");
  const css = [...h.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n") + [...h.matchAll(/style\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).join("\n");
  for (const m of css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const hex = normHex(m[1]);
    if (!isGrey(hex)) counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const colors = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const themeHex = theme && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(theme) ? normHex(theme.slice(1)) : null;
  return { title, text, logoUrl, imageUrls, colors: [...new Set([...(themeHex ? [themeHex] : []), ...colors])].slice(0, 8) };
}

function normHex(h: string): string {
  const x = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return `#${x.toLowerCase()}`;
}

function isGrey(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b) < 16;
}
