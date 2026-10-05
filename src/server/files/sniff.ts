// Content sniffing for uploads (TASK-005b, ADR-033): the type comes from the bytes, never from the file name or
// the browser's Content-Type. Pure functions, bounds-checked; anything unrecognised is "unknown".

export type Sniffed =
  | "pdf" | "docx" | "xlsx" | "pptx"
  | "png" | "jpeg" | "webp"
  | "ttf" | "otf"
  | "text"
  | "unknown";

const startsWith = (b: Uint8Array, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/**
 * Names in a ZIP's central directory. Throws on a malformed archive. Only reads headers — never decompresses.
 * Office Open XML files are ZIPs; their part names tell docx / xlsx / pptx apart.
 */
export function zipEntryNames(b: Uint8Array, max = 10_000): string[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // End of central directory: signature 0x06054b50, within the last 22 + 65535 bytes.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP_NO_EOCD");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  if (count > max) throw new Error("ZIP_TOO_MANY_ENTRIES");
  const names: string[] = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP_BAD_ENTRY");
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    if (p + 46 + nameLen > b.length) throw new Error("ZIP_TRUNCATED");
    names.push(dec.decode(b.subarray(p + 46, p + 46 + nameLen)));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

function officeKind(b: Uint8Array): Sniffed {
  let names: string[];
  try {
    names = zipEntryNames(b);
  } catch {
    return "unknown";
  }
  const has = (n: string) => names.includes(n);
  if (!has("[Content_Types].xml")) return "unknown";
  if (has("word/document.xml")) return "docx";
  if (has("xl/workbook.xml")) return "xlsx";
  if (has("ppt/presentation.xml")) return "pptx";
  return "unknown";
}

/** Valid UTF-8 (BOM allowed) without NUL bytes → text. */
function isText(b: Uint8Array): boolean {
  if (b.length === 0 || b.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

export function sniff(b: Uint8Array): Sniffed {
  if (startsWith(b, ascii("%PDF-"))) return "pdf";
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8)) return "webp";
  if (startsWith(b, [0x00, 0x01, 0x00, 0x00]) || startsWith(b, ascii("true"))) return "ttf";
  if (startsWith(b, ascii("OTTO"))) return "otf";
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) return officeKind(b);
  if (isText(b)) return "text";
  return "unknown";
}

export const CONTENT_TYPES: Record<Exclude<Sniffed, "unknown">, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  ttf: "font/ttf",
  otf: "font/otf",
  text: "text/plain; charset=utf-8",
};
