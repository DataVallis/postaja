// Minimal TrueType/OpenType reader (TASK-005b, ADR-033): enough to prove a font is well-formed, read its family
// name and check glyph coverage for Slovenian (and neighbouring) diacritics. Bounds-checked: a malformed font throws.

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
