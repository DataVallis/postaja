import { describe, expect, it } from "vitest";
import { brandFromName, brandNameFromFile, suggestChannel } from "./service";

const brands = [
  { id: "ab", name: "AI Builders", slug: "aibuilders" },
  { id: "ch", name: "Cherr", slug: "cherr" },
  { id: "in", name: "Inženirji", slug: "inzenirji" },
];
const channels = [
  { id: "ab-x", platform: "x", handle: "@aibuilders_si", brandId: "ab", brandName: "AI Builders" },
  { id: "ab-ig", platform: "instagram", handle: "@aibuilders.si", brandId: "ab", brandName: "AI Builders" },
  { id: "ch-ig", platform: "instagram", handle: "@cherr.io", brandId: "ch", brandName: "Cherr" },
];

describe("brandFromName", () => {
  it("finds the brand a file names, with diacritics and punctuation folded", () => {
    expect(brandFromName("CHERR.IO X posts 001 (1).xlsx", brands)?.id).toBe("ch");
    expect(brandFromName("AI Builders — 30 dni objav (29. 9. – 28. 10. 2026).xlsx", brands)?.id).toBe("ab");
    expect(brandFromName("inzenirji-100-dni.xlsx", brands)?.id).toBe("in");
    expect(brandFromName("plan oktober.xlsx", brands)).toBeNull();
    expect(brandFromName("cherr in aibuilders skupaj.xlsx", brands)).toBeNull(); // two brands: no guess
  });
});

describe("suggestChannel", () => {
  const many = (name: string) => ({ brand: brandFromName(name, brands), brandCount: brands.length });

  it("never puts another brand's plan on the only channel of the platform (owner: CHERR X plan landed on AI Builders)", () => {
    expect(suggestChannel("x", null, channels, many("CHERR.IO X posts 001 (1).xlsx"))).toBeNull();
    expect(suggestChannel("x", null, channels, many("plan oktober.xlsx"))).toBeNull(); // several brands, nothing named
    expect(suggestChannel("x", "@cherr_io", channels, many("plan.xlsx"))).toBeNull(); // the account is someone else's
  });

  it("suggests by account handle, then by the brand the file names, never the only channel of another brand", () => {
    expect(suggestChannel("x", "@aibuilders_si", channels, many("plan.xlsx"))).toBe("ab-x");
    expect(suggestChannel("instagram", null, channels, many("CHERR.IO IG.xlsx"))).toBe("ch-ig");
    expect(suggestChannel("x", null, channels, many("AI Builders X.xlsx"))).toBe("ab-x");
    expect(suggestChannel("instagram", "@cherr.io", channels, many("AI Builders.xlsx"))).toBe("ch-ig"); // account wins
    const li = [...channels, { id: "dt-li", platform: "linkedin", handle: "davidtacer", brandId: "dt", brandName: "David Tacer" }];
    expect(suggestChannel("linkedin", "David (osebni profil)", li, many("AI Builders 30 dni.xlsx"))).toBe("dt-li");
    // A one-brand org: a plan that names no brand is not put on that brand's channel by guess (CHERR.IO plan → AI Builders X).
    expect(suggestChannel("x", null, channels.slice(0, 1), { brand: null, brandCount: 1 })).toBeNull();
    expect(suggestChannel(null, null, channels, many("x.xlsx"))).toBeNull();
  });
});

describe("brandNameFromFile", () => {
  it("keeps the brand part of a plan's file name", () => {
    expect(brandNameFromFile("CHERR.IO X posts 001 (1).xlsx")).toBe("CHERR.IO");
    expect(brandNameFromFile("AI Builders — 30 dni objav (29. 9. – 28. 10. 2026).xlsx")).toBe("AI Builders");
    expect(brandNameFromFile("IG_Content_Plan___100_dni_inzenirji.si.xlsx")).toBe("inzenirji.si");
    expect(brandNameFromFile("LinkedIn plan.docx")).toBeNull();
    expect(brandNameFromFile("2026-10.csv")).toBeNull();
  });
});
