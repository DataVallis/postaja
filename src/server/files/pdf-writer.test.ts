import sharp from "sharp";
import { getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { pdfFromJpegs } from "./pdf-writer";

const jpeg = async (w: number, h: number, bg: string) => new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: bg } }).jpeg().toBuffer());

describe("pdfFromJpegs", () => {
  it("one page per image at the image's size, readable by pdf.js, title with č š ž", async () => {
    const pdf = pdfFromJpegs([{ jpeg: await jpeg(1080, 1350, "#112233"), width: 1080, height: 1350 }, { jpeg: await jpeg(1080, 1080, "#ff0000"), width: 1080, height: 1080 }], "Karusel čšž");
    expect(new TextDecoder().decode(pdf.slice(0, 8))).toBe("%PDF-1.4");
    const doc = await getDocumentProxy(pdf);
    expect(doc.numPages).toBe(2);
    const sizes = await Promise.all([1, 2].map(async (n) => { const v = (await doc.getPage(n)).getViewport({ scale: 1 }); return [v.width, v.height]; }));
    expect(sizes).toEqual([[1080, 1350], [1080, 1080]]);
    expect((await doc.getMetadata()).info).toMatchObject({ Title: "Karusel čšž" });
    const ops = await (await doc.getPage(1)).getOperatorList();
    expect(ops.fnArray.length).toBeGreaterThan(0); // the page draws something (the image)
  });

  it("refuses no pages and non-JPEG bytes", async () => {
    expect(() => pdfFromJpegs([])).toThrow("NO_PAGES");
    const png = new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 3, background: "#000" } }).png().toBuffer());
    expect(() => pdfFromJpegs([{ jpeg: png, width: 2, height: 2 }])).toThrow("NOT_JPEG");
  });
});
