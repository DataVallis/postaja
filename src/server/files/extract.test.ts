import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { image, makeDocx, makeZipEntries, pdf } from "../../../tests/fixtures/files";
import { decodeXml, docxToText, documentText, ExtractError, tidy } from "./extract";

const enc = (s: string) => new TextEncoder().encode(s);

describe("document text (verbatim, no AI)", () => {
  it("PDF with Slovenian text: every page, in order, diacritics intact", async () => {
    const bytes = new Uint8Array(fs.readFileSync("tests/fixtures/docs/cgp.pdf"));
    expect(await documentText(bytes)).toEqual({
      kind: "pdf",
      text: "CGP Inženirji\nPišemo strokovno, toplo in brez žargona.\nCiljna publika: inženirji in študenti.\n\nČesa ne delamo: obljub brez dokazov.",
    });
  });

  it("DOCX: runs joined, headings (English and Slovenian style names) → #, list items → -, entities decoded", async () => {
    const docx = makeDocx([
      { text: "Inženirji", style: "Title" },
      { text: "Kdo smo", style: "Heading1" },
      { text: "Pišemo za inženirje & študente <vsi>." },
      { text: "" },
      { text: "Ton", style: "Naslov2" },
      { text: "strokovno", list: true },
      { text: "toplo", list: true },
    ]);
    expect(await documentText(docx)).toEqual({
      kind: "docx",
      text: "# Inženirji\n# Kdo smo\nPišemo za inženirje & študente <vsi>.\n\n## Ton\n- strokovno\n- toplo",
    });
  });

  it("TXT/MD: BOM removed, CRLF normalised, trailing spaces trimmed, 3+ blank lines collapsed", async () => {
    expect(await documentText(enc("﻿# CGP  \r\n\r\n\r\n\r\nTon: topel.\r\n"))).toEqual({ kind: "text", text: "# CGP\n\nTon: topel." });
  });

  it("refuses images, plain ZIPs, scanned/empty PDFs, empty text and broken DOCX", async () => {
    await expect(documentText(await image("png"))).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
    await expect(documentText(makeZipEntries([{ name: "a.txt", bytes: enc("x") }]))).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
    await expect(documentText(pdf("no real pages"))).rejects.toBeInstanceOf(ExtractError); // not a parseable PDF
    await expect(documentText(enc("   \n\n  "))).rejects.toMatchObject({ code: "NO_TEXT" });
    const noBody = makeZipEntries([
      { name: "[Content_Types].xml", bytes: enc("<Types/>") },
      { name: "word/document.xml", bytes: enc("<w:document/>") },
    ]);
    expect(() => docxToText(noBody)).not.toThrow(); // valid but empty → "" (documentText turns it into NO_TEXT)
    await expect(documentText(noBody)).rejects.toMatchObject({ code: "NO_TEXT" });
  });

  it("helpers: numeric entities, invalid code points dropped; tidy keeps single blank lines", () => {
    expect(decodeXml("&#269;&#x161;&amp;&#0;&#x110000;")).toBe("čš&");
    expect(tidy("a\n\nb\n\n\n\nc")).toBe("a\n\nb\n\nc");
  });
});
