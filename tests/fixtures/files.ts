// Synthetic upload fixtures built in code (no binary files in the repo, every byte is known to the test).
import sharp from "sharp";

class W {
  private parts: number[] = [];
  u8(v: number) { this.parts.push(v & 0xff); return this; }
  u16(v: number) { return this.u8(v >> 8).u8(v); }
  u32(v: number) { return this.u16(v >>> 16).u16(v & 0xffff); }
  bytes(b: Uint8Array | number[]) { this.parts.push(...b); return this; }
  get length() { return this.parts.length; }
  done() { return new Uint8Array(this.parts); }
}

/** cmap with one Windows Unicode subtable mapping each char to glyph 1..n (format 4: one segment per char). */
function cmap(chars: string[], format: 4 | 12): Uint8Array {
  const cps = [...new Set(chars.map((c) => c.codePointAt(0)!))].sort((a, b) => a - b);
  const sub = new W();
  if (format === 12) {
    sub.u16(12).u16(0).u32(16 + cps.length * 12).u32(0).u32(cps.length);
    cps.forEach((cp, i) => sub.u32(cp).u32(cp).u32(i + 1));
  } else {
    const segs = [...cps, 0xffff];
    const segX2 = segs.length * 2;
    const len = 16 + segX2 * 4;
    sub.u16(4).u16(len).u16(0).u16(segX2).u16(0).u16(0).u16(0);
    segs.forEach((cp) => sub.u16(cp)); // endCode
    sub.u16(0);
    segs.forEach((cp) => sub.u16(cp)); // startCode
    segs.forEach((cp, i) => sub.u16(cp === 0xffff ? 1 : (i + 1 - cp) & 0xffff)); // idDelta → glyph i+1
    segs.forEach(() => sub.u16(0)); // idRangeOffset
  }
  return new W().u16(0).u16(1).u16(3).u16(format === 12 ? 10 : 1).u32(12).bytes(sub.done()).done();
}

function nameTable(family: string): Uint8Array {
  const s = new W();
  for (const ch of family) s.u16(ch.charCodeAt(0));
  const str = s.done();
  return new W().u16(0).u16(1).u16(18).u16(3).u16(1).u16(0x409).u16(1).u16(str.length).u16(0).bytes(str).done();
}

/** A minimal but well-formed sfnt with `cmap` (+ `name`). Glyph data is irrelevant for coverage checks. */
export function makeFont(opts: { chars: string; format?: 4 | 12; family?: string; otf?: boolean }): Uint8Array {
  const tables: [string, Uint8Array][] = [["cmap", cmap([...opts.chars], opts.format ?? 4)]];
  if (opts.family) tables.push(["name", nameTable(opts.family)]);
  const out = new W().u32(opts.otf ? 0x4f54544f : 0x00010000).u16(tables.length).u16(0).u16(0).u16(0);
  let offset = 12 + tables.length * 16;
  for (const [tag, data] of tables) {
    out.bytes([...tag].map((c) => c.charCodeAt(0))).u32(0).u32(offset).u32(data.length);
    offset += data.length;
  }
  for (const [, data] of tables) out.bytes(data);
  return out.done();
}

/** Stored (uncompressed) ZIP with the given entry names, each holding `content`. */
export function makeZip(names: string[], content = "x"): Uint8Array {
  const enc = new TextEncoder();
  const body = enc.encode(content);
  const le16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
  const le32 = (v: number) => [...le16(v & 0xffff), ...le16(v >>> 16)];
  const local: number[] = [];
  const central: number[] = [];
  for (const n of names) {
    const name = enc.encode(n);
    const at = local.length;
    local.push(...le32(0x04034b50), ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(body.length), ...le32(body.length), ...le16(name.length), ...le16(0), ...name, ...body);
    central.push(...le32(0x02014b50), ...le16(20), ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(body.length), ...le32(body.length), ...le16(name.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(at), ...name);
  }
  const eocd = [...le32(0x06054b50), ...le16(0), ...le16(0), ...le16(names.length), ...le16(names.length), ...le32(central.length), ...le32(local.length), ...le16(0)];
  return new Uint8Array([...local, ...central, ...eocd]);
}

export const OOXML = {
  docx: ["[Content_Types].xml", "_rels/.rels", "word/document.xml"],
  xlsx: ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml"],
  pptx: ["[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml"],
};

export const pdf = (text = "hello") => new TextEncoder().encode(`%PDF-1.4\n% ${text}\n%%EOF\n`);

export async function image(format: "png" | "jpeg" | "webp", w = 40, h = 30, opts: { alpha?: boolean; exif?: boolean } = {}) {
  let img = sharp({ create: { width: w, height: h, channels: opts.alpha ? 4 : 3, background: opts.alpha ? { r: 200, g: 10, b: 10, alpha: 0.5 } : "#c80a0a" } });
  if (opts.exif) img = img.withExif({ IFD0: { Artist: "Secret Person", Copyright: "GPS 46.55,15.64" } });
  return new Uint8Array(await img.toFormat(format).toBuffer());
}

/** ZIP with real per-entry content; `deflate` compresses entries (method 8), `flags` sets general-purpose bits. */
export function makeZipEntries(entries: { name: string; bytes: Uint8Array; deflate?: boolean; flags?: number; declaredSize?: number }[]): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { deflateRawSync } = require("node:zlib") as typeof import("node:zlib");
  const enc = new TextEncoder();
  const le16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
  const le32 = (v: number) => [...le16(v & 0xffff), ...le16(v >>> 16)];
  const local: number[] = [];
  const central: number[] = [];
  for (const e of entries) {
    const name = enc.encode(e.name);
    const data = e.deflate ? new Uint8Array(deflateRawSync(e.bytes)) : e.bytes;
    const method = e.deflate ? 8 : 0;
    const usize = e.declaredSize ?? e.bytes.length;
    const at = local.length;
    const flags = e.flags ?? 0;
    local.push(...le32(0x04034b50), ...le16(20), ...le16(flags), ...le16(method), ...le16(0), ...le16(0), ...le32(0), ...le32(data.length), ...le32(usize), ...le16(name.length), ...le16(0), ...name);
    for (const x of data) local.push(x);
    central.push(...le32(0x02014b50), ...le16(20), ...le16(20), ...le16(flags), ...le16(method), ...le16(0), ...le16(0), ...le32(0), ...le32(data.length), ...le32(usize), ...le16(name.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(at), ...name);
  }
  const eocd = [...le32(0x06054b50), ...le16(0), ...le16(0), ...le16(entries.length), ...le16(entries.length), ...le32(central.length), ...le32(local.length), ...le16(0)];
  const out = new Uint8Array(local.length + central.length + eocd.length);
  out.set(local, 0); out.set(central, local.length); out.set(eocd, local.length + central.length);
  return out;
}

/** WOFF 1.0 wrapper around an sfnt (tables zlib-compressed when it helps), per the W3C WOFF spec. */
export function makeWoff(sfnt: Uint8Array): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { deflateSync } = require("node:zlib") as typeof import("node:zlib");
  const v = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const num = v.getUint16(4);
  const tables = Array.from({ length: num }, (_, i) => {
    const p = 12 + i * 16;
    const off = v.getUint32(p + 8), len = v.getUint32(p + 12);
    const orig = sfnt.subarray(off, off + len);
    const z = new Uint8Array(deflateSync(orig));
    return { tag: v.getUint32(p), sum: v.getUint32(p + 4), orig, data: z.length < orig.length ? z : orig };
  });
  const dirEnd = 44 + num * 20;
  let at = dirEnd;
  const offsets = tables.map((t) => { const o = at; at += (t.data.length + 3) & ~3; return o; });
  const totalSfnt = 12 + num * 16 + tables.reduce((s, t) => s + ((t.orig.length + 3) & ~3), 0);
  const out = new Uint8Array(at);
  const o = new DataView(out.buffer);
  o.setUint32(0, 0x774f4646); o.setUint32(4, v.getUint32(0)); o.setUint32(8, at); o.setUint16(12, num); o.setUint32(16, totalSfnt);
  tables.forEach((t, i) => {
    const p = 44 + i * 20;
    o.setUint32(p, t.tag); o.setUint32(p + 4, offsets[i]); o.setUint32(p + 8, t.data.length); o.setUint32(p + 12, t.orig.length); o.setUint32(p + 16, t.sum);
    out.set(t.data, offsets[i]);
  });
  return out;
}

/** A minimal .docx: one paragraph per item; `style` sets w:pStyle (e.g. "Heading1", "Naslov2"), `list` adds w:numPr. */
export function makeDocx(paragraphs: { text: string; style?: string; list?: boolean }[]): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = paragraphs
    .map((p) => {
      const props = p.style || p.list ? `<w:pPr>${p.style ? `<w:pStyle w:val="${p.style}"/>` : ""}${p.list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ""}</w:pPr>` : "";
      // Split each paragraph into two runs to prove runs are joined; tabs/breaks as Word writes them.
      const half = Math.ceil(p.text.length / 2);
      const runs = p.text ? `<w:r><w:t xml:space="preserve">${esc(p.text.slice(0, half))}</w:t></w:r><w:r><w:t>${esc(p.text.slice(half))}</w:t></w:r>` : "";
      return `<w:p>${props}${runs}</w:p>`;
    })
    .join("");
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
  const enc = new TextEncoder();
  return makeZipEntries([
    { name: "[Content_Types].xml", bytes: enc.encode('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>') },
    { name: "_rels/.rels", bytes: enc.encode('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>') },
    { name: "word/document.xml", bytes: enc.encode(doc), deflate: true },
  ]);
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A minimal .xlsx. Strings go to sharedStrings (or inline when `inline`), numbers stay numbers. Sheets are listed in
 * workbook.xml in the given order but stored under reversed part names, to prove the relationships are followed.
 */
export function makeXlsx(sheets: { name: string; rows: (string | number | boolean | null)[][]; inline?: boolean }[]): Uint8Array {
  const enc = new TextEncoder();
  const shared: string[] = [];
  const col = (i: number) => String.fromCharCode(65 + i);
  const parts = sheets.map((sh, si) => {
    const rows = sh.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      const ref = `${col(ci)}${ri + 1}`;
      if (v === null) return "";
      if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
      if (typeof v === "boolean") return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
      if (sh.inline) return `<c r="${ref}" t="inlineStr"><is><t>${xmlEsc(v)}</t></is></c>`;
      shared.push(v);
      return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
    }).join("")}</row>`).join("");
    return { path: `worksheets/sheet${sheets.length - si}.xml`, xml: `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>` };
  });
  const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`;
  const wbRels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${parts.map((p, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${p.path}"/>`).join("")}</Relationships>`;
  // Shared strings with one rich-text item split into two runs, as Excel writes formatted cells.
  const sst = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared.map((s) => {
    const half = Math.ceil(s.length / 2);
    return s.length > 3 ? `<si><r><t xml:space="preserve">${xmlEsc(s.slice(0, half))}</t></r><r><t>${xmlEsc(s.slice(half))}</t></r></si>` : `<si><t>${xmlEsc(s)}</t></si>`;
  }).join("")}</sst>`;
  return makeZipEntries([
    { name: "[Content_Types].xml", bytes: enc.encode('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>') },
    { name: "_rels/.rels", bytes: enc.encode('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>') },
    { name: "xl/workbook.xml", bytes: enc.encode(workbook), deflate: true },
    { name: "xl/_rels/workbook.xml.rels", bytes: enc.encode(wbRels) },
    { name: "xl/sharedStrings.xml", bytes: enc.encode(sst), deflate: true },
    ...parts.map((p) => ({ name: `xl/${p.path}`, bytes: enc.encode(p.xml), deflate: true })),
  ]);
}

/** A minimal .pptx: each slide is a list of paragraphs (each split into two runs); slide parts stored in reverse order. */
export function makePptx(slides: string[][]): Uint8Array {
  const enc = new TextEncoder();
  const n = slides.length;
  const slideXml = (paras: string[]) => `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>${paras.map((t) => {
    const half = Math.ceil(t.length / 2);
    return `<a:p><a:r><a:t>${xmlEsc(t.slice(0, half))}</a:t></a:r><a:r><a:t>${xmlEsc(t.slice(half))}</a:t></a:r></a:p>`;
  }).join("")}<a:p/></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  const pres = `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldIdLst></p:presentation>`;
  const presRels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n - i}.xml"/>`).join("")}</Relationships>`;
  return makeZipEntries([
    { name: "[Content_Types].xml", bytes: enc.encode('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>') },
    { name: "_rels/.rels", bytes: enc.encode('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>') },
    { name: "ppt/presentation.xml", bytes: enc.encode(pres) },
    { name: "ppt/_rels/presentation.xml.rels", bytes: enc.encode(presRels) },
    ...slides.map((s, i) => ({ name: `ppt/slides/slide${n - i}.xml`, bytes: enc.encode(slideXml(s)), deflate: true })),
  ]);
}
