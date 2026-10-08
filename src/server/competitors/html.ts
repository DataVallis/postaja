// Readable text of a public web page (TASK-050): title, meta description and the visible text, without scripts, styles,
// navigation chrome or markup. Plain code, no parser dependency; the text is only shown to Claude as data.
export const PAGE_TEXT_MAX = 20_000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—", laquo: "«", raquo: "»", bdquo: "„", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", euro: "€", copy: "©", reg: "®", trade: "™" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const attr = (tag: string, name: string) => new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(2).find((x) => x !== undefined);

/** `{ title, text }` of an HTML page; `text` starts with the meta description when there is one. */
export function htmlToText(html: string): { title: string; text: string } {
  let h = html.slice(0, 3_000_000);
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const metaTag = /<meta\b[^>]*(?:name|property)\s*=\s*["'](?:og:)?description["'][^>]*>/i.exec(h)?.[0];
  const description = metaTag ? decodeEntities(attr(metaTag, "content") ?? "").replace(/\s+/g, " ").trim() : "";
  h = h
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|form)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/?(p|div|section|article|header|main|aside|li|ul|ol|h[1-6]|tr|table|blockquote|figure|figcaption|dd|dt)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const body = decodeEntities(h)
    .split("\n")
    .map((l) => l.replace(/[ \t \r\f\v]+/g, " ").trim())
    .filter(Boolean)
    .filter((l, i, all) => all.indexOf(l) === i) // menus and repeated blocks once
    .join("\n");
  const text = [description, body].filter(Boolean).join("\n").slice(0, PAGE_TEXT_MAX);
  return { title, text };
}
