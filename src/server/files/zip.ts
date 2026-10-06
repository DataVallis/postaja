// Safe ZIP unpacking for "drop a whole folder" uploads (TASK-005c, ADR-034). Reads the central directory, inflates
// each entry with a hard output cap (the declared size is never trusted) and stops at count / total-size limits.
import { inflateRawSync } from "node:zlib";

export type ZipLimits = { maxEntries: number; maxEntryBytes: number; maxTotalBytes: number };
export const ZIP_LIMITS: ZipLimits = { maxEntries: 200, maxEntryBytes: 50 * 1024 * 1024, maxTotalBytes: 300 * 1024 * 1024 };

export type ZipEntry =
  | { name: string; ok: true; bytes: Uint8Array }
  | { name: string; ok: false; reason: "TOO_LARGE" | "ENCRYPTED" | "UNSUPPORTED_COMPRESSION" | "CORRUPT" };

/**
 * Inflates at most `cap` bytes. zlib stops producing output at the cap and throws (ERR_BUFFER_TOO_LARGE), so a bomb
 * never allocates more than the cap, whatever its header claims.
 */
export function inflateCapped(raw: Uint8Array, cap: number): Uint8Array {
  return new Uint8Array(inflateRawSync(raw, { maxOutputLength: cap }));
}

/** Skipped silently: folders, macOS/Windows metadata, hidden files. */
export const isJunk = (name: string) =>
  name.endsWith("/") || /(^|\/)__MACOSX\//.test(name) || /(^|\/)\./.test(name) || /(^|\/)(Thumbs\.db|desktop\.ini)$/i.test(name);

/** Throws ZIP_INVALID (not a readable archive), ZIP_TOO_MANY_ENTRIES or ZIP_TOO_LARGE (total). */
export function unzip(b: Uint8Array, limits: ZipLimits = ZIP_LIMITS): ZipEntry[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const dec = new TextDecoder();
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP_INVALID");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  let files = 0;
  let total = 0;
  try {
    for (let n = 0; n < count; n++) {
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP_INVALID");
      const flags = v.getUint16(p + 8, true);
      const method = v.getUint16(p + 10, true);
      const csize = v.getUint32(p + 20, true);
      const nameLen = v.getUint16(p + 28, true);
      const extraLen = v.getUint16(p + 30, true);
      const commentLen = v.getUint16(p + 32, true);
      const localAt = v.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (isJunk(name)) continue;
      if (++files > limits.maxEntries) throw new Error("ZIP_TOO_MANY_ENTRIES");
      if (flags & 1) { out.push({ name, ok: false, reason: "ENCRYPTED" }); continue; }
      if (csize === 0xffffffff || localAt === 0xffffffff) { out.push({ name, ok: false, reason: "UNSUPPORTED_COMPRESSION" }); continue; } // ZIP64
      if (v.getUint32(localAt, true) !== 0x04034b50) { out.push({ name, ok: false, reason: "CORRUPT" }); continue; }
      const dataAt = localAt + 30 + v.getUint16(localAt + 26, true) + v.getUint16(localAt + 28, true);
      if (dataAt + csize > b.length) { out.push({ name, ok: false, reason: "CORRUPT" }); continue; }
      const raw = b.subarray(dataAt, dataAt + csize);
      let bytes: Uint8Array;
      if (method === 0) {
        bytes = raw;
      } else if (method === 8) {
        try {
          // maxOutputLength makes a lying header harmless: inflation stops at the cap and throws.
          bytes = inflateCapped(raw, limits.maxEntryBytes + 1);
        } catch (e) {
          const tooBig = (e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE" || /larger than/i.test(String(e));
          out.push({ name, ok: false, reason: tooBig ? "TOO_LARGE" : "CORRUPT" });
          continue;
        }
      } else {
        out.push({ name, ok: false, reason: "UNSUPPORTED_COMPRESSION" });
        continue;
      }
      if (bytes.length > limits.maxEntryBytes) { out.push({ name, ok: false, reason: "TOO_LARGE" }); continue; }
      total += bytes.length;
      if (total > limits.maxTotalBytes) throw new Error("ZIP_TOO_LARGE");
      out.push({ name, ok: true, bytes });
    }
  } catch (e) {
    if (e instanceof RangeError) throw new Error("ZIP_INVALID");
    throw e;
  }
  return out;
}
