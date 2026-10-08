// The user guide as one PDF (TASK-044): cover, contents with page numbers, every chapter from a new page, page numbers
// in the footer. Real text (selectable, searchable) in the app's own fonts — Inter for text, JetBrains Mono for code —
// embedded as subsets, so č š ž ć đ print correctly. Built from the same Markdown blocks as /app/help.
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { guideChapters } from "./guide";
import type { Block, Inline } from "./markdown";

const A4 = { w: 595.28, h: 841.89 };
const M = { x: 56, top: 64, bottom: 64 };
const WIDTH = A4.w - 2 * M.x;
const INK = rgb(0.09, 0.1, 0.13);
const MUTED = rgb(0.42, 0.45, 0.5);
const SIGNAL = rgb(1, 0.35, 0.12);

type Fonts = { regular: PDFFont; bold: PDFFont; mono: PDFFont; symbols: PDFFont };
type Run = { text: string; font: PDFFont; color?: ReturnType<typeof rgb> };

const fontDir = () => path.join(/*turbopackIgnore: true*/ process.cwd(), "assets", "fonts");

/** Inline Markdown → runs of one font each (bold for **…**, mono for `…`, links as their text). */
function runs(v: Inline[], f: Fonts, bold = false): Run[] {
  return v.flatMap((x): Run[] => {
    if (x.t === "text") return [{ text: x.v, font: bold ? f.bold : f.regular }];
    if (x.t === "strong") return runs(x.v, f, true);
    if (x.t === "code") return [{ text: x.v, font: f.mono }];
    return runs(x.v, f, bold).map((r) => ({ ...r, color: SIGNAL }));
  });
}

const charsets = new WeakMap<PDFFont, Set<number>>();
const has = (font: PDFFont, ch: string) => {
  let set = charsets.get(font);
  if (!set) charsets.set(font, (set = new Set(font.getCharacterSet())));
  return set.has(ch.codePointAt(0)!);
};

/** Text in one run split by the font that can draw it: → ✓ and other symbols come from the symbols font; unknown → "?". */
function segments(r: Run, symbols: PDFFont): Run[] {
  const out: Run[] = [];
  for (const raw of r.text) {
    const ch = raw === "\u00a0" ? " " : raw;
    const font = has(r.font, ch) ? r.font : has(symbols, ch) ? symbols : r.font;
    const text = font === r.font && !has(r.font, ch) ? "?" : ch;
    const last = out[out.length - 1];
    if (last && last.font === font) last.text += text;
    else out.push({ ...r, font, text });
  }
  return out;
}

/** A single line of plain text in `font` (titles, contents), symbols included. */
function drawLine(page: PDFPage, text: string, o: { x: number; y: number; size: number; font: PDFFont; symbols: PDFFont; color: ReturnType<typeof rgb> }) {
  let x = o.x;
  for (const seg of segments({ text, font: o.font }, o.symbols)) {
    page.drawText(seg.text, { x, y: o.y, size: o.size, font: seg.font, color: o.color });
    x += seg.font.widthOfTextAtSize(seg.text, o.size);
  }
}

class Writer {
  doc: PDFDocument;
  f: Fonts;
  page!: PDFPage;
  y = 0;
  constructor(doc: PDFDocument, f: Fonts) { this.doc = doc; this.f = f; }
  newPage() { this.page = this.doc.addPage([A4.w, A4.h]); this.y = A4.h - M.top; return this.page; }
  ensure(h: number) { if (this.y - h < M.bottom) this.newPage(); }

  /** Word-wrapped runs at `size`; a word spanning styles ("**Brand**.") never breaks inside. Moves y. */
  paragraph(rs: Run[], size: number, o: { indent?: number; lead?: string; gap?: number; color?: ReturnType<typeof rgb> } = {}) {
    const indent = o.indent ?? 0;
    const lineH = size * 1.45;
    type Word = { space: boolean; parts: Run[]; width: number };
    const words: Word[] = [];
    for (const r of rs) {
      for (const piece of r.text.split(/(\s+)/)) {
        if (!piece) continue;
        if (/^\s+$/.test(piece)) { words.push({ space: true, parts: [], width: this.f.regular.widthOfTextAtSize(" ", size) }); continue; }
        const parts = segments({ ...r, text: piece }, this.f.symbols);
        const width = parts.reduce((w, p) => w + p.font.widthOfTextAtSize(p.text, size), 0);
        const last = words[words.length - 1];
        if (last && !last.space) { last.parts.push(...parts); last.width += width; } else words.push({ space: false, parts, width });
      }
    }
    const lines: Word[][] = [[]];
    let width = 0;
    const max = WIDTH - indent;
    for (const w of words) {
      if (!w.space && width + w.width > max && width > 0) { lines.push([]); width = 0; }
      if (w.space && width === 0) continue;
      lines[lines.length - 1].push(w);
      width += w.width;
    }
    lines.forEach((line, i) => {
      this.ensure(lineH);
      if (i === 0 && o.lead) this.page.drawText(o.lead, { x: M.x + indent - 14, y: this.y - size, size, font: this.f.regular, color: MUTED });
      let x = M.x + indent;
      for (const w of line) {
        if (w.space) { x += w.width; continue; }
        for (const r of w.parts) {
          this.page.drawText(r.text, { x, y: this.y - size, size, font: r.font, color: r.color ?? o.color ?? INK });
          x += r.font.widthOfTextAtSize(r.text, size);
        }
      }
      this.y -= lineH;
    });
    this.y -= o.gap ?? size * 0.6;
  }

  block(b: Block) {
    const f = this.f;
    if (b.t === "h") {
      const size = b.level === 2 ? 14 : 12;
      this.ensure(size * 4); // a heading never ends a page alone
      this.y -= size * 0.5;
      this.paragraph(runs(b.v, f, true), size, { gap: size * 0.4 });
    } else if (b.t === "p") this.paragraph(runs(b.v, f), 10.5);
    else if (b.t === "quote") {
      const top = this.y;
      this.paragraph(runs(b.v, f), 10.5, { indent: 14, color: MUTED });
      this.page.drawRectangle({ x: M.x, y: this.y + 6, width: 2, height: Math.max(8, top - this.y - 6), color: SIGNAL });
    } else {
      b.items.forEach((item, i) => this.paragraph(runs(item, f), 10.5, { indent: 18, lead: b.t === "ol" ? `${i + 1}.` : "•", gap: 3 }));
      this.y -= 6;
    }
  }
}

export type GuidePdfText = { title: string; subtitle: string; contents: string; page: string };

/** The whole guide in `locale` as a PDF. */
export async function guidePdf(locale: string, text: GuidePdfText): Promise<Uint8Array> {
  const chapters = await guideChapters(locale);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const load = async (n: string) => doc.embedFont(await readFile(/*turbopackIgnore: true*/ path.join(fontDir(), n)), { subset: true });
  const f: Fonts = { regular: await load("Inter-Regular.woff"), bold: await load("Inter-Bold.woff"), mono: await load("JetBrainsMono-Regular.woff"), symbols: await load("NotoSansSymbols-Regular.woff") };
  doc.setTitle(text.title);
  doc.setLanguage(locale);
  doc.setCreator("Postaja");

  const w = new Writer(doc, f);
  // Cover.
  const cover = w.newPage();
  cover.drawText("postaja.", { x: M.x, y: A4.h - 160, size: 30, font: f.bold, color: INK });
  drawLine(cover, text.title, { x: M.x, y: A4.h - 210, size: 22, font: f.bold, symbols: f.symbols, color: INK });
  drawLine(cover, text.subtitle, { x: M.x, y: A4.h - 240, size: 11, font: f.regular, symbols: f.symbols, color: MUTED });
  // Contents: filled in once the chapters' pages are known.
  const toc = w.newPage();
  const starts: number[] = [];
  for (const [i, c] of chapters.entries()) {
    w.newPage();
    starts.push(doc.getPageCount());
    w.paragraph([{ text: `${i + 1}. ${c.title}`, font: f.bold }], 20, { gap: 10 });
    for (const b of c.blocks) w.block(b);
  }
  drawLine(toc, text.contents, { x: M.x, y: A4.h - M.top - 20, size: 20, font: f.bold, symbols: f.symbols, color: INK });
  chapters.forEach((c, i) => {
    const y = A4.h - M.top - 64 - i * 24;
    drawLine(toc, `${i + 1}. ${c.title}`, { x: M.x, y, size: 12, font: f.regular, symbols: f.symbols, color: INK });
    const n = String(starts[i]);
    toc.drawText(n, { x: A4.w - M.x - f.regular.widthOfTextAtSize(n, 12), y, size: 12, font: f.regular, color: MUTED });
  });
  // Page numbers (not on the cover).
  doc.getPages().forEach((p, i) => {
    if (i === 0) return;
    const s = `${text.page} ${i + 1}`;
    p.drawText(s, { x: A4.w - M.x - f.regular.widthOfTextAtSize(s, 9), y: 32, size: 9, font: f.regular, color: MUTED });
  });
  return doc.save();
}
