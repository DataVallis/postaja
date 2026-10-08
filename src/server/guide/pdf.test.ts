// The guide as a PDF (TASK-044): real text with Slovenian letters, contents with page numbers, both languages.
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { guidePdf } from "./pdf";

async function read(locale: string, text: Parameters<typeof guidePdf>[1]) {
  const bytes = await guidePdf(locale, text);
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text: pages } = await extractText(pdf);
  return { totalPages, pages: pages as string[] };
}

describe("guide PDF", () => {
  it("Slovenian: cover, contents with each chapter's page, chapters with č š ž, page numbers", async () => {
    const { totalPages, pages } = await read("sl", { title: "Navodila za uporabo", subtitle: "Postaja · stanje 2026-10-08", contents: "Vsebina", page: "stran" });
    expect(totalPages).toBeGreaterThan(12);
    expect(pages[0]).toContain("Navodila za uporabo");
    expect(pages[1]).toContain("Vsebina");
    expect(pages[1]).toContain("10. Konkurenca");
    const start = Number(/10\. Konkurenca\s+(\d+)/.exec(pages[1])![1]);
    expect(pages[start - 1]).toContain("10. Konkurenca");
    expect(pages.join("\n")).toMatch(/Spusti partnerske logotipe sem/);
    expect(pages.join("\n")).toMatch(/šumniki|č|ž/);
    expect(pages[2]).toContain("stran 3");
  }, 30_000);

  it("English uses the English chapters", async () => {
    const { pages } = await read("en", { title: "User guide", subtitle: "Postaja · as of 2026-10-08", contents: "Contents", page: "page" });
    expect(pages[1]).toContain("1. Getting started");
    expect(pages[1]).toContain("10. Competitors");
    expect(pages.join("\n")).not.toContain("Navodila");
  }, 30_000);
});
