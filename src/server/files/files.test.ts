import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { image, makeFont, makeZip, OOXML, pdf } from "../../../tests/fixtures/files";
import { inspectFont, REQUIRED_GLYPHS } from "./font";
import { MAX_INPUT_PIXELS, reencodeImage } from "./images";
import { sniff, zipEntryNames } from "./sniff";
import { contentDisposition, s3ConfigFromEnv } from "./storage";

const enc = (s: string) => new TextEncoder().encode(s);

describe("sniff (by bytes, never by name)", () => {
  it("recognises every accepted type", async () => {
    expect(sniff(pdf())).toBe("pdf");
    expect(sniff(makeZip(OOXML.docx))).toBe("docx");
    expect(sniff(makeZip(OOXML.xlsx))).toBe("xlsx");
    expect(sniff(makeZip(OOXML.pptx))).toBe("pptx");
    expect(sniff(await image("png"))).toBe("png");
    expect(sniff(await image("jpeg"))).toBe("jpeg");
    expect(sniff(await image("webp"))).toBe("webp");
    expect(sniff(makeFont({ chars: "a" }))).toBe("ttf");
    expect(sniff(makeFont({ chars: "a", otf: true }))).toBe("otf");
    expect(sniff(enc("Ime;Cena\nčaj;3\n"))).toBe("text");
    expect(sniff(enc("﻿# Naslov"))).toBe("text");
  });

  it("refuses look-alikes and unknown data", () => {
    expect(sniff(new Uint8Array())).toBe("unknown");
    expect(sniff(enc("%PD"))).toBe("text"); // one byte short of the PDF signature: just text, never "pdf"
    expect(sniff(makeZip(["word/document.xml"]))).toBe("zip"); // no [Content_Types].xml → a plain archive, not Word
    expect(sniff(makeZip(["[Content_Types].xml", "evil.exe"]))).toBe("zip"); // plain ZIP
    expect(sniff(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toBe("unknown"); // truncated ZIP
    expect(sniff(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe("unknown"); // legacy .doc/.xls
    expect(sniff(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBe("unknown"); // Windows executable
    expect(sniff(enc("<svg onload=alert(1)>").map((b, i) => (i === 3 ? 0 : b)))).toBe("unknown"); // NUL byte
    expect(sniff(new Uint8Array([0x61, 0xc3, 0x28]))).toBe("unknown"); // invalid UTF-8
  });

  it("a ZIP's names come from the central directory; a corrupt directory throws", () => {
    expect(zipEntryNames(makeZip(["a.txt", "b/č.xml"]))).toEqual(["a.txt", "b/č.xml"]);
    const z = makeZip(["a.txt"]);
    z[z.length - 22 + 16] = 0xff; // central directory offset points nowhere
    expect(() => zipEntryNames(z)).toThrow();
  });
});

describe("fonts", () => {
  it("full Slovenian coverage → nothing missing; family name read (format 4 and 12)", () => {
    for (const format of [4, 12] as const) {
      const f = inspectFont(makeFont({ chars: `abc${REQUIRED_GLYPHS}`, format, family: "Brand Sans" }));
      expect(f).toEqual({ family: "Brand Sans", missingGlyphs: [] });
    }
  });

  it("reports exactly the missing diacritics; boundary: all but one", () => {
    expect(inspectFont(makeFont({ chars: "abcčšž" })).missingGlyphs).toEqual(["ć", "đ", "Č", "Š", "Ž", "Ć", "Đ"]);
    expect(inspectFont(makeFont({ chars: REQUIRED_GLYPHS.replace("Đ", "") })).missingGlyphs).toEqual(["Đ"]);
    expect(inspectFont(makeFont({ chars: "abc" })).family).toBeNull();
  });

  it("malformed fonts throw instead of being stored", () => {
    const f = makeFont({ chars: REQUIRED_GLYPHS });
    expect(() => inspectFont(f.subarray(0, 20))).toThrow(/FONT_/);
    const noTables = f.slice();
    noTables[5] = 0; // numTables = 0
    expect(() => inspectFont(noTables)).toThrow("FONT_BAD_DIRECTORY");
  });
});

describe("image re-encoding", () => {
  it("strips metadata, keeps size, PNG for logos and transparency, JPEG otherwise", async () => {
    const src = await image("jpeg", 40, 30, { exif: true });
    expect((await sharp(src).metadata()).exif).toBeDefined();
    const out = await reencodeImage(src, "image");
    expect(out).toMatchObject({ ext: "jpg", contentType: "image/jpeg", width: 40, height: 30 });
    expect((await sharp(out.bytes).metadata()).exif).toBeUndefined();
    expect((await reencodeImage(src, "logo")).ext).toBe("png");
    expect((await reencodeImage(await image("webp", 10, 10, { alpha: true }), "image")).ext).toBe("png");
  });

  it("caps the longest side: logo 2048 (2049 → 2048, 2048 stays), others 4096; never enlarges", async () => {
    expect((await reencodeImage(await image("png", 2049, 100), "logo")).width).toBe(2048);
    expect((await reencodeImage(await image("png", 2048, 100), "logo")).width).toBe(2048);
    expect((await reencodeImage(await image("png", 100, 4097), "image")).height).toBe(4096);
    expect((await reencodeImage(await image("png", 5, 5), "image")).width).toBe(5);
  });

  it("refuses decompression bombs (pixel limit) and garbage", async () => {
    expect(MAX_INPUT_PIXELS).toBe(40_000_000);
    const bomb = new Uint8Array(await sharp({ create: { width: 8000, height: 5001, channels: 3, background: "#000" } }).png({ compressionLevel: 1 }).toBuffer()); // 40,008,000 px
    await expect(reencodeImage(bomb, "image")).rejects.toThrow("IMAGE_INVALID");
    const ok = new Uint8Array(await sharp({ create: { width: 8000, height: 5000, channels: 3, background: "#000" } }).png({ compressionLevel: 1 }).toBuffer()); // exactly the limit
    await expect(reencodeImage(ok, "image")).resolves.toMatchObject({ width: 4096 });
    const png = await image("png");
    await expect(reencodeImage(png.subarray(0, 40), "image")).rejects.toThrow("IMAGE_INVALID");
  });
});

describe("storage helpers", () => {
  it("Content-Disposition keeps UTF-8 names and an ASCII fallback without quotes", () => {
    expect(contentDisposition('Cenik "2026" – č.pdf', false)).toBe(`attachment; filename="Cenik 2026  c.pdf"; filename*=UTF-8''Cenik%20%222026%22%20%E2%80%93%20%C4%8D.pdf`);
    expect(contentDisposition("logo.png", true)).toMatch(/^inline; /);
  });

  it("missing S3 config names the variables, never values", () => {
    expect(() => s3ConfigFromEnv({ S3_ENDPOINT: "x", S3_SECRET_ACCESS_KEY: "do-not-print" })).toThrow("S3_NOT_CONFIGURED:S3_REGION,S3_BUCKET,S3_ACCESS_KEY_ID");
    try { s3ConfigFromEnv({ S3_SECRET_ACCESS_KEY: "do-not-print" }); } catch (e) { expect(String(e)).not.toContain("do-not-print"); }
  });
});

describe("web fonts are converted to TTF/OTF", () => {
  it("WOFF → same tables, same coverage and family; corrupt WOFF throws", async () => {
    const { makeWoff } = await import("../../../tests/fixtures/files");
    const { woffToSfnt } = await import("./font");
    const ttf = makeFont({ chars: `abc${REQUIRED_GLYPHS}`, family: "Web Sans" });
    const woff = makeWoff(ttf);
    expect(sniff(woff)).toBe("woff");
    const back = woffToSfnt(woff);
    expect(sniff(back)).toBe("ttf");
    expect(inspectFont(back)).toEqual({ family: "Web Sans", missingGlyphs: [] });
    expect(() => woffToSfnt(woff.subarray(0, 60))).toThrow(/FONT_/);
  });

  it("WOFF2 (Google's encoder) → TTF readable by the inspector; garbage WOFF2 throws", async () => {
    const { compress } = await import("wawoff2");
    const { woff2ToSfnt } = await import("./font");
    const fs = await import("node:fs");
    const real = new Uint8Array(fs.readFileSync("tests/fixtures/fonts/TinySans.ttf")); // a complete font (WOFF2 needs glyf/loca)
    const w2 = await compress(real);
    expect(sniff(w2)).toBe("woff2");
    const back = await woff2ToSfnt(w2);
    expect(inspectFont(back)).toEqual({ family: "Tiny Sans", missingGlyphs: [] });
    await expect(woff2ToSfnt(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0, 9, 9]))).rejects.toThrow("FONT_TRUNCATED");
  });
});

describe("SVG and plain ZIPs are recognised", () => {
  it("svg in its usual shapes; text that merely mentions <svg> stays text", () => {
    for (const s of ["<svg/>", "<svg xmlns='http://www.w3.org/2000/svg'/>", '<?xml version="1.0"?>\n<svg>', "﻿<!-- x -->\n<svg width=1>", '<!DOCTYPE svg PUBLIC "x">\n<svg>'])
      expect(sniff(enc(s)), s).toBe("svg");
    expect(sniff(enc("Naš logo je v <svg> formatu."))).toBe("text");
  });

  it("a ZIP that is not Office is 'zip'", () => {
    expect(sniff(makeZip(["a.txt", "b.pdf"]))).toBe("zip");
  });
});

describe("unzip (safe)", () => {
  it("stored and deflated entries come back byte-exact; folders and OS junk are skipped", async () => {
    const { makeZipEntries } = await import("../../../tests/fixtures/files");
    const { unzip } = await import("./zip");
    const a = pdf("a");
    const b = enc("č".repeat(5000));
    const z = makeZipEntries([
      { name: "brand/", bytes: new Uint8Array() },
      { name: "brand/a.pdf", bytes: a },
      { name: "brand/notes.txt", bytes: b, deflate: true },
      { name: "__MACOSX/brand/._a.pdf", bytes: enc("junk") },
      { name: "brand/.DS_Store", bytes: enc("junk") },
      { name: "Thumbs.db", bytes: enc("junk") },
    ]);
    const out = unzip(z);
    expect(out.map((e) => e.name)).toEqual(["brand/a.pdf", "brand/notes.txt"]);
    expect(out.map((e) => (e.ok ? e.bytes : null))).toEqual([a, b]);
  });

  it("bomb: a deflated entry that inflates past the cap is TOO_LARGE even when its header lies", async () => {
    const { makeZipEntries } = await import("../../../tests/fixtures/files");
    const { unzip } = await import("./zip");
    const zeros = new Uint8Array(3 * 1024 * 1024); // compresses to a few KB
    const z = makeZipEntries([{ name: "bomb.txt", bytes: zeros, deflate: true, declaredSize: 10 }]);
    const limits = { maxEntries: 10, maxEntryBytes: 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 };
    expect(z.length).toBeLessThan(20_000);
    expect(unzip(z, limits)).toEqual([{ name: "bomb.txt", ok: false, reason: "TOO_LARGE" }]);
    // exactly at the cap is fine
    const at = makeZipEntries([{ name: "ok.txt", bytes: new Uint8Array(1024 * 1024), deflate: true }]);
    expect(unzip(at, limits)[0]).toMatchObject({ ok: true });
  });

  it("inflateCapped never produces more than the cap (memory guard): a 64 MB bomb stops at 1 MB", async () => {
    const { inflateCapped } = await import("./zip");
    const { deflateRawSync } = await import("node:zlib");
    const bomb = new Uint8Array(deflateRawSync(new Uint8Array(64 * 1024 * 1024), { level: 1 }));
    expect(() => inflateCapped(bomb, 1024 * 1024)).toThrow(expect.objectContaining({ code: "ERR_BUFFER_TOO_LARGE" }));
    expect(inflateCapped(new Uint8Array(deflateRawSync(new Uint8Array(1024))), 1024)).toHaveLength(1024); // exactly the cap
  });

  it("limits: entry count exact/+1, total size, encrypted, unknown method, not a zip", async () => {
    const { makeZipEntries } = await import("../../../tests/fixtures/files");
    const { unzip } = await import("./zip");
    const limits = { maxEntries: 3, maxEntryBytes: 1000, maxTotalBytes: 2500 };
    const f = (n: number, size = 10) => Array.from({ length: n }, (_, i) => ({ name: `f${i}.txt`, bytes: new Uint8Array(size).fill(97) }));
    expect(unzip(makeZipEntries(f(3)), limits)).toHaveLength(3);
    expect(() => unzip(makeZipEntries(f(4)), limits)).toThrow("ZIP_TOO_MANY_ENTRIES");
    expect(() => unzip(makeZipEntries(f(3, 900)), limits)).toThrow("ZIP_TOO_LARGE"); // 2700 > 2500
    expect(unzip(makeZipEntries([{ name: "s.txt", bytes: enc("x"), flags: 1 }]), limits)[0]).toMatchObject({ ok: false, reason: "ENCRYPTED" });
    const odd = makeZipEntries([{ name: "m.txt", bytes: enc("x") }]);
    odd[8] = 12; // local header method → bzip2 is not read; central directory decides
    const cdMethod = odd.length - 22 - (46 + 5) + 10;
    odd[cdMethod] = 12;
    expect(unzip(odd, limits)[0]).toMatchObject({ ok: false, reason: "UNSUPPORTED_COMPRESSION" });
    expect(() => unzip(enc("not a zip"), limits)).toThrow("ZIP_INVALID");
  });
});

describe("classify (where a dropped file goes)", () => {
  it("fonts → font, images named logo → logo, other images and documents → source", async () => {
    const { classify } = await import("../brands/files");
    expect(classify("Inter.woff2", "woff2")).toBe("font");
    expect(classify("brand/Logo-dark.PNG", "png")).toBe("logo");
    expect(classify("team-photo.jpg", "jpeg")).toBe("source");
    expect(classify("logo-guidelines.pdf", "pdf")).toBe("source");
  });
});
