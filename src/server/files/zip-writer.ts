// Streaming ZIP writer (TASK-016): one entry at a time, so a day of posts never sits in memory as a whole. Text is
// deflated, images (already compressed) are stored. Names are UTF-8 (flag bit 11); no ZIP64 (limits keep us far
// below 4 GB and 65,535 entries).
import { crc32, deflateRawSync } from "node:zlib";

export type ZipSource = { name: string; bytes: () => Promise<Uint8Array> };

const enc = new TextEncoder();

/** DOS date/time of `d` (local fields of the ZIP format; UTC here, fine for a download). */
function dosTime(d: Date) {
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  const date = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

const compressible = (name: string) => /\.(txt|csv|md|json)$/i.test(name);

/** A ZIP of `entries` as a web stream; each entry's bytes are fetched only when it is written. */
export function zipStream(entries: ZipSource[], now = new Date()): ReadableStream<Uint8Array> {
  const { time, date } = dosTime(now);
  const central: Uint8Array[] = [];
  let offset = 0;
  let i = 0;
  let finished = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      if (i < entries.length) {
        const e = entries[i++];
        const name = enc.encode(e.name);
        const raw = await e.bytes();
        const crc = crc32(raw) >>> 0;
        const deflate = compressible(e.name);
        const data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
        const method = deflate ? 8 : 0;
        const local = new Uint8Array(30 + name.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0x0800, true); // UTF-8 names
        lv.setUint16(8, method, true);
        lv.setUint16(10, time, true);
        lv.setUint16(12, date, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, raw.length, true);
        lv.setUint16(26, name.length, true);
        lv.setUint16(28, 0, true);
        local.set(name, 30);
        const cd = new Uint8Array(46 + name.length);
        const cv = new DataView(cd.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, method, true);
        cv.setUint16(12, time, true);
        cv.setUint16(14, date, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, raw.length, true);
        cv.setUint16(28, name.length, true);
        cv.setUint32(42, offset, true);
        cd.set(name, 46);
        central.push(cd);
        controller.enqueue(local);
        controller.enqueue(data);
        offset += local.length + data.length;
        return;
      }
      const size = central.reduce((n, c) => n + c.length, 0);
      for (const c of central) controller.enqueue(c);
      const end = new Uint8Array(22);
      const ev = new DataView(end.buffer);
      ev.setUint32(0, 0x06054b50, true);
      ev.setUint16(8, central.length, true);
      ev.setUint16(10, central.length, true);
      ev.setUint32(12, size, true);
      ev.setUint32(16, offset, true);
      controller.enqueue(end);
      finished = true;
      controller.close();
    },
  });
}

/** Whole ZIP as bytes (tests, small archives). */
export async function zipBytes(entries: ZipSource[]): Promise<Uint8Array> {
  return new Uint8Array(await new Response(zipStream(entries)).arrayBuffer());
}
