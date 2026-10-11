import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { image, makeDocx, makePptx, makeXlsx, makeZipEntries } from "../../../tests/fixtures/files";
import { ExtractError, materialText, MATERIAL_TEXT_MAX, pptxToText, xlsxToText, XLSX_MAX_ROWS } from "./extract";
import { sniff } from "./sniff";

const enc = (s: string) => new TextEncoder().encode(s);

describe("XLSX material text", () => {
  it("sheets in workbook order (not part order), rows as 'a | b', shared rich-text strings joined, numbers and booleans", () => {
    const x = makeXlsx([
      { name: "Cenik", rows: [["Izdelek", "Cena €", "Na zalogi"], ["Tečaj Vibe Coding", 149, true], ["Delavnica & mentorstvo", 490.5, false]] },
      { name: "Termini <2026>", rows: [["Datum", "Kraj"], ["12. 11. 2026", "Maribor"]], inline: true },
    ]);
    expect(sniff(x)).toBe("xlsx");
    expect(xlsxToText(x)).toBe(
      "## Cenik\nIzdelek | Cena € | Na zalogi\nTečaj Vibe Coding | 149 | TRUE\nDelavnica & mentorstvo | 490.5 | FALSE\n\n## Termini <2026>\nDatum | Kraj\n12. 11. 2026 | Maribor",
    );
  });

  it("empty rows and trailing empty cells are dropped; a gap inside a row stays an empty cell at its position", () => {
    const x = makeXlsx([{ name: "S", rows: [["a", null, "c", null], [null, null], ["", "x"]] }]);
    expect(xlsxToText(x)).toBe("## S\na |  | c\n | x"); // Excel omits empty cells; positions come from the cell reference
  });

  it("at most XLSX_MAX_ROWS rows per sheet", () => {
    const rows = Array.from({ length: XLSX_MAX_ROWS + 3 }, (_, i) => [i + 1]);
    const lines = xlsxToText(makeXlsx([{ name: "Big", rows }])).split("\n");
    expect(lines).toHaveLength(XLSX_MAX_ROWS + 1);
    expect(lines.at(-1)).toBe(String(XLSX_MAX_ROWS));
  });
});

describe("PPTX material text", () => {
  it("slides in presentation order (not part order), runs joined, empty paragraphs and empty slides skipped", () => {
    const p = makePptx([["Kdo smo", "Inženirji za inženirje"], [], ["Ponudba", "Tečaj: 149 €"]]);
    expect(sniff(p)).toBe("pptx");
    expect(pptxToText(p)).toBe("## Prosojnica 1\nKdo smo\nInženirji za inženirje\n\n## Prosojnica 3\nPonudba\nTečaj: 149 €");
  });
});

describe("materialText by kind", () => {
  it("every text kind; images and broken files are refused with a code", async () => {
    expect(await materialText(makeDocx([{ text: "Naslov", style: "Heading1" }, { text: "Vsebina" }]), "docx")).toBe("# Naslov\nVsebina");
    expect(await materialText(new Uint8Array(fs.readFileSync("tests/fixtures/docs/cgp.pdf")), "pdf")).toContain("Pišemo strokovno");
    expect(await materialText(enc("﻿ime;cena\r\nA;1\r\n"), "csv")).toBe("ime;cena\nA;1");
    expect(await materialText(makeXlsx([{ name: "S", rows: [["x"]] }]), "xlsx")).toBe("## S\nx");
    expect(await materialText(makePptx([["y"]]), "pptx")).toBe("## Prosojnica 1\ny");
    await expect(materialText(await image("png"), "image")).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
    await expect(materialText(enc("   \n "), "text")).rejects.toMatchObject({ code: "NO_TEXT" });
    await expect(materialText(makeXlsx([{ name: "Prazno", rows: [] }]), "xlsx")).rejects.toMatchObject({ code: "NO_TEXT" });
    const noWorkbook = makeZipEntries([{ name: "xl/other.xml", bytes: enc("<x/>") }]);
    expect(() => xlsxToText(noWorkbook)).toThrow(ExtractError);
    expect(() => pptxToText(enc("not a zip"))).toThrow(ExtractError);
  });

  it("is capped at MATERIAL_TEXT_MAX characters", async () => {
    const big = "ž".repeat(MATERIAL_TEXT_MAX + 10);
    expect((await materialText(enc(big), "text")).length).toBe(MATERIAL_TEXT_MAX);
  });
});
