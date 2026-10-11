// A tiny Markdown subset for the user guide (TASK-026): headings, paragraphs, bullet and numbered lists, block quotes,
// **bold**, `code`, \*escaped stars\* and links. It produces a tree of plain data (no HTML strings), so the page renders
// it with React and nothing in a guide file can inject markup. Links are kept only when internal (/app/…) or https.
export type Inline = { t: "text"; v: string } | { t: "strong"; v: Inline[] } | { t: "code"; v: string } | { t: "link"; href: string; v: Inline[] };
export type Block =
  | { t: "h"; level: 1 | 2 | 3; v: Inline[]; id: string }
  | { t: "p"; v: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] }
  | { t: "quote"; v: Inline[] };

/** A heading's anchor: lower case, ASCII letters for č/š/ž, dashes. */
export function slugify(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "razdelek";
}

const safeHref = (h: string) => (/^\/(app|login)(\/|$|#|\?)/.test(h) || /^https:\/\/[^\s]+$/.test(h) || /^#[\w-]+$/.test(h) ? h : null);

export function inline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => { if (text) { out.push({ t: "text", v: text }); text = ""; } };
  for (let i = 0; i < src.length; ) {
    const rest = src.slice(i);
    if (rest.startsWith("\\") && rest.length > 1) { text += rest[1]; i += 2; continue; }
    let m = rest.match(/^\*\*(.+?)\*\*/);
    if (m) { flush(); out.push({ t: "strong", v: inline(m[1]) }); i += m[0].length; continue; }
    m = rest.match(/^`([^`]+)`/);
    if (m) { flush(); out.push({ t: "code", v: m[1] }); i += m[0].length; continue; }
    m = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
    if (m) {
      flush();
      const href = safeHref(m[2]);
      if (href) out.push({ t: "link", href, v: inline(m[1]) });
      else out.push(...inline(m[1]));
      i += m[0].length;
      continue;
    }
    text += src[i];
    i++;
  }
  flush();
  return out;
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let list: { t: "ul" | "ol"; items: string[] } | null = null;
  const ids = new Map<string, number>();
  const flushPara = () => { if (para.length) { blocks.push({ t: "p", v: inline(para.join(" ")) }); para = []; } };
  const flushList = () => { if (list) { blocks.push({ t: list.t, items: list.items.map(inline) }); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    const q = line.match(/^>\s?(.*)$/);
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (h) {
      flushPara(); flushList();
      const base = slugify(h[2]);
      const n = ids.get(base) ?? 0;
      ids.set(base, n + 1);
      blocks.push({ t: "h", level: h[1].length as 1 | 2 | 3, v: inline(h[2]), id: n ? `${base}-${n + 1}` : base });
    } else if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      if (list && list.t !== kind) flushList();
      list ??= { t: kind, items: [] };
      list.items.push((ul ?? ol)![1]);
    } else if (q) {
      flushPara(); flushList();
      blocks.push({ t: "quote", v: inline(q[1]) });
    } else if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}

/** Plain text of inline nodes (titles, search). */
export const plain = (v: Inline[]): string => v.map((n) => (n.t === "text" || n.t === "code" ? n.v : plain(n.v))).join("");
