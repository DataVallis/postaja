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
    expect(sniff(makeZip(["word/document.xml"]))).toBe("unknown"); // no [Content_Types].xml
    expect(sniff(makeZip(["[Content_Types].xml", "evil.exe"]))).toBe("unknown"); // plain ZIP
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
