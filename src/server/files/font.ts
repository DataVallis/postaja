// Minimal TrueType/OpenType reader (TASK-005b, ADR-033): enough to prove a font is well-formed, read its family
// name and check glyph coverage for Slovenian (and neighbouring) diacritics. Bounds-checked: a malformed font throws.
import { inflateSync } from "node:zlib";


/** Characters every brand font must cover for Slovenian text (plus ć/đ used in names). */
export const REQUIRED_GLYPHS = "čšžćđČŠŽĆĐ";

type Table = { offset: number; length: number };

function tables(v: DataView): Map<string, Table> {
  const num = v.getUint16(4);
  if (num === 0 || num > 200) throw new Error("FONT_BAD_DIRECTORY");
  const out = new Map<string, Table>();
  for (let i = 0; i < num; i++) {
    const p = 12 + i * 16;
    const tag = String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3));
    const offset = v.getUint32(p + 8);
    const length = v.getUint32(p + 12);
    if (offset + length > v.byteLength) throw new Error("FONT_TABLE_OUT_OF_BOUNDS");
    out.set(tag, { offset, length });
  }
  return out;
}

/** Returns a code point → glyph id lookup from the best Unicode cmap subtable (format 12 or 4). */
function cmapLookup(v: DataView, cmap: Table): (cp: number) => number {
  const n = v.getUint16(cmap.offset + 2);
  let best: { format: number; at: number } | null = null;
  for (let i = 0; i < n; i++) {
    const p = cmap.offset + 4 + i * 8;
    const platform = v.getUint16(p);
    const encoding = v.getUint16(p + 2);
    const at = cmap.offset + v.getUint32(p + 4);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const format = v.getUint16(at);
    if (format === 12 && (!best || best.format !== 12)) best = { format, at };
    else if (format === 4 && !best) best = { format, at };
  }
  if (!best) throw new Error("FONT_NO_UNICODE_CMAP");
  const at = best.at;
  if (best.format === 12) {
    const groups = v.getUint32(at + 12);
    if (at + 16 + groups * 12 > v.byteLength) throw new Error("FONT_CMAP_OUT_OF_BOUNDS");
    return (cp) => {
      for (let g = 0; g < groups; g++) {
        const q = at + 16 + g * 12;
        const start = v.getUint32(q);
        const end = v.getUint32(q + 4);
        if (cp >= start && cp <= end) return v.getUint32(q + 8) + (cp - start);
      }
      return 0;
    };
  }
  const segX2 = v.getUint16(at + 6);
  const ends = at + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffsets = deltas + segX2;
  if (rangeOffsets + segX2 > v.byteLength) throw new Error("FONT_CMAP_OUT_OF_BOUNDS");
  return (cp) => {
    if (cp > 0xffff) return 0;
    for (let s = 0; s < segX2; s += 2) {
      const end = v.getUint16(ends + s);
      if (cp > end) continue;
      const start = v.getUint16(starts + s);
      if (cp < start) return 0;
      const delta = v.getInt16(deltas + s);
      const ro = v.getUint16(rangeOffsets + s);
      if (ro === 0) return (cp + delta) & 0xffff;
      const gp = rangeOffsets + s + ro + (cp - start) * 2;
      if (gp + 2 > v.byteLength) return 0;
      const g = v.getUint16(gp);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
}

/** Family name from the `name` table (typographic family 16, else family 1); Windows Unicode or Mac Roman. */
function familyName(v: DataView, name: Table | undefined): string | null {
  if (!name) return null;
  const count = v.getUint16(name.offset + 2);
  const strings = name.offset + v.getUint16(name.offset + 4);
  let found: { id: number; text: string } | null = null;
  for (let i = 0; i < count; i++) {
    const p = name.offset + 6 + i * 12;
    const platform = v.getUint16(p);
    const nameId = v.getUint16(p + 6);
    const len = v.getUint16(p + 8);
    const off = strings + v.getUint16(p + 10);
    if ((nameId !== 1 && nameId !== 16) || off + len > v.byteLength) continue;
    let text: string;
    if (platform === 3 || platform === 0) {
      text = "";
      for (let k = 0; k + 1 < len; k += 2) text += String.fromCharCode(v.getUint16(off + k));
    } else if (platform === 1) {
      text = String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset + off, len));
    } else continue;
    if (!found || (nameId === 16 && found.id !== 16)) found = { id: nameId, text };
  }
  const clean = found?.text.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100);
  return clean ? clean : null;
}

export type FontInfo = { family: string | null; missingGlyphs: string[] };

/** Parses a TTF/OTF. Throws FONT_* errors for malformed data. */
export function inspectFont(bytes: Uint8Array): FontInfo {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const t = tables(v);
    const cmap = t.get("cmap");
    if (!cmap) throw new Error("FONT_NO_CMAP");
    const lookup = cmapLookup(v, cmap);
    const missingGlyphs = [...REQUIRED_GLYPHS].filter((c) => lookup(c.codePointAt(0)!) === 0);
    return { family: familyName(v, t.get("name")), missingGlyphs };
  } catch (e) {
    if (e instanceof RangeError) throw new Error("FONT_TRUNCATED");
    throw e;
  }
}

/** OpenType Font Variations tables. Satori (opentype.js) cannot parse a font that carries them. */
const VARIATION_TABLES = new Set(["fvar", "gvar", "avar", "cvar", "HVAR", "VVAR", "MVAR", "STAT"]);

/** Whether the font is a variable font (has an `fvar` table). Throws FONT_* for malformed data. */
export function isVariableFont(bytes: Uint8Array): boolean {
  try {
    return tables(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)).has("fvar");
  } catch (e) {
    if (e instanceof RangeError) throw new Error("FONT_TRUNCATED");
    throw e;
  }
}

const checksum = (b: Uint8Array): number => {
  const padded = new Uint8Array((b.length + 3) & ~3);
  padded.set(b);
  const v = new DataView(padded.buffer);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
  return sum;
};

/**
 * A variable font → its default instance as a static font: the variation tables are dropped, the default outlines
 * (glyf/CFF) stay. Google Fonts ship most families only as variable TTFs, which the renderer cannot read
 * (incident 2026-10-10). A static font is returned unchanged. Throws FONT_* for malformed data.
 */
export function staticInstance(bytes: Uint8Array): Uint8Array {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const all = tables(v);
    if (!all.has("fvar")) return bytes;
    const keep = [...all.entries()].filter(([tag]) => !VARIATION_TABLES.has(tag)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const num = keep.length;
    let size = 12 + num * 16;
    for (const [, t] of keep) size += (t.length + 3) & ~3;
    const out = new Uint8Array(size);
    const o = new DataView(out.buffer);
    let searchRange = 1, entrySelector = 0;
    while (searchRange * 2 <= num) { searchRange *= 2; entrySelector++; }
    o.setUint32(0, v.getUint32(0)); o.setUint16(4, num); o.setUint16(6, searchRange * 16); o.setUint16(8, entrySelector); o.setUint16(10, num * 16 - searchRange * 16);
    let at = 12 + num * 16;
    let headAt = -1;
    keep.forEach(([tag, t], i) => {
      const data = bytes.subarray(t.offset, t.offset + t.length);
      out.set(data, at);
      if (tag === "head") { headAt = at; o.setUint32(at + 8, 0); } // checkSumAdjustment is recomputed below
      const d = 12 + i * 16;
      for (let k = 0; k < 4; k++) o.setUint8(d + k, tag.charCodeAt(k));
      o.setUint32(d + 4, checksum(out.subarray(at, at + t.length))); o.setUint32(d + 8, at); o.setUint32(d + 12, t.length);
      at += (t.length + 3) & ~3;
    });
    if (headAt >= 0) o.setUint32(headAt + 8, (0xb1b0afba - checksum(out)) >>> 0);
    return out;
  } catch (e) {
    if (e instanceof RangeError) throw new Error("FONT_TRUNCATED");
    throw e;
  }
}

/** Upper bound for a converted font (a decompression guard for WOFF/WOFF2). */
export const MAX_SFNT_BYTES = 30 * 1024 * 1024;

/**
 * WOFF 1.0 → plain TTF/OTF (in-house: zlib per table). The renderer (Satori) needs TTF/OTF; brands often only have
 * web fonts. Throws FONT_* on malformed input.
 */
export function woffToSfnt(b: Uint8Array): Uint8Array {
  try {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const flavor = v.getUint32(4);
    const num = v.getUint16(12);
    const total = v.getUint32(16);
    if (num === 0 || num > 200 || total > MAX_SFNT_BYTES) throw new Error("FONT_BAD_DIRECTORY");
    const out = new Uint8Array(total);
    const o = new DataView(out.buffer);
    let searchRange = 1, entrySelector = 0;
    while (searchRange * 2 <= num) { searchRange *= 2; entrySelector++; }
    o.setUint32(0, flavor); o.setUint16(4, num); o.setUint16(6, searchRange * 16); o.setUint16(8, entrySelector); o.setUint16(10, num * 16 - searchRange * 16);
    let at = 12 + num * 16;
    for (let i = 0; i < num; i++) {
      const p = 44 + i * 20;
      const tag = v.getUint32(p), off = v.getUint32(p + 4), comp = v.getUint32(p + 8), orig = v.getUint32(p + 12), sum = v.getUint32(p + 16);
      if (off + comp > b.length) throw new Error("FONT_TABLE_OUT_OF_BOUNDS");
      const src = b.subarray(off, off + comp);
      const data = comp < orig ? new Uint8Array(inflateSync(src, { maxOutputLength: orig + 1 })) : src;
      if (data.length !== orig || at + orig > total) throw new Error("FONT_TABLE_OUT_OF_BOUNDS");
      const d = 12 + i * 16;
      o.setUint32(d, tag); o.setUint32(d + 4, sum); o.setUint32(d + 8, at); o.setUint32(d + 12, orig);
      out.set(data, at);
      at += (orig + 3) & ~3; // 4-byte aligned tables
    }
    return out.subarray(0, Math.min(at, total));
  } catch (e) {
    if (e instanceof RangeError || (e as { code?: string }).code?.startsWith("Z_") || (e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new Error("FONT_TRUNCATED");
    throw e;
  }
}

/** WOFF2 → TTF/OTF via Google's reference decoder (wawoff2, WebAssembly). */
export async function woff2ToSfnt(b: Uint8Array): Promise<Uint8Array> {
  const { decompress } = await import("wawoff2");
  let out: Uint8Array;
  try {
    out = await decompress(b);
  } catch {
    throw new Error("FONT_TRUNCATED");
  }
  if (out.length === 0 || out.length > MAX_SFNT_BYTES) throw new Error("FONT_TOO_LARGE");
  return out;
}
