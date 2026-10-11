import { describe, expect, it } from "vitest";
import { chunk, CHUNK_CHARS, selectMaterials, terms } from "./retrieve";

/** ~900+ characters: two never share a chunk (CHUNK_CHARS = 1500), so each is its own passage. */
const para = (w: string, n = 120) => `${w} `.repeat(Math.max(n, Math.ceil(900 / (w.length + 1)))).trim();

describe("terms", () => {
  it("folds case and Slovenian diacritics, drops short words and stop words", () => {
    expect(terms("Založba ČŠŽ in Đuro: cenik 2026, Objava za IG")).toEqual(["zalozba", "csz", "duro", "cenik", "2026"]);
  });
});

describe("chunk", () => {
  it("keeps paragraphs together up to the limit; a too-long paragraph is cut on a space", () => {
    expect(chunk("a\n\nb\n\n\nc", 10)).toEqual(["a\n\nb\n\nc"]);
    expect(chunk("aaaa bbbb\n\ncccc dddd", 10)).toEqual(["aaaa bbbb", "cccc dddd"]);
    const long = "word ".repeat(700).trim();
    const parts = chunk(long);
    expect(parts.every((p) => p.length <= CHUNK_CHARS)).toBe(true);
    expect(parts.join(" ")).toBe(long);
  });
});

describe("selectMaterials", () => {
  const docs = [
    { name: "novo.txt", text: [para("uvod"), para("splosno"), `Cenik: tečaj 149 €. ${para("opis")}`].join("\n\n") },
    { name: "staro.txt", text: [para("zgodovina"), `Založba izdaja knjige. ${para("vec")}`].join("\n\n") },
  ];

  it("everything (untouched, in order) when it fits", () => {
    expect(selectMaterials(docs, "karkoli", 10_000)).toEqual(docs);
    expect(selectMaterials([...docs, { name: "prazno.txt", text: "  " }], "x", 10_000)).toEqual(docs);
  });

  it("over budget: the matching passage wins, diacritics and case do not matter, gaps are marked", () => {
    const one = selectMaterials(docs, "CENIK tecaja", 1200);
    expect(one).toEqual([{ name: "novo.txt", text: `[…]\n\nCenik: tečaj 149 €. ${para("opis")}` }]);
    const other = selectMaterials(docs, "zalozba", 1200);
    expect(other).toEqual([{ name: "staro.txt", text: `[…]\n\nZaložba izdaja knjige. ${para("vec")}` }]);
  });

  it("the file name counts as part of each passage", () => {
    const named = [{ name: "a.txt", text: para("x") }, { name: "cenik.txt", text: para("y") }];
    expect(selectMaterials(named, "cenik", 1200).map((m) => m.name)).toEqual(["cenik.txt"]);
  });

  it("no match: the start of the newest document first, within budget", () => {
    const picked = selectMaterials(docs, "nič skupnega", 1200);
    expect(picked).toEqual([{ name: "novo.txt", text: para("uvod") }]);
  });

  it("never exceeds the budget", () => {
    const big = Array.from({ length: 20 }, (_, i) => ({ name: `d${i}.txt`, text: Array.from({ length: 30 }, (_, j) => para(`w${i}x${j}`)).join("\n\n") }));
    for (const budget of [2000, 5000, 60_000]) {
      const out = selectMaterials(big, "w3x7 w11x2", budget);
      expect(out.reduce((n, m) => n + m.text.length, 0)).toBeLessThanOrEqual(budget);
      expect(out.length).toBeGreaterThan(0);
      // the two matching passages come first (each ~900 chars, so at 2000 only they fit)
      if (budget === 2000) expect(out.map((m) => m.text.match(/^\[…\]\n\n(\w+) /)?.[1]).sort()).toEqual(["w11x2", "w3x7"]);
    }
  });
});
