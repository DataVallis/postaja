import { describe, expect, it } from "vitest";
import { adCopySchema, adCopyRequest } from "./ai";
import { checkAdCopy, isHard, textsOf, type NetworkSpec } from "./check";

const meta: NetworkSpec = {
  key: "meta",
  fields: [
    { key: "primary_text", label: "Primary text", min: 1, max: 1, maxChars: 2200, recommended: 125 },
    { key: "headline", label: "Headline", min: 1, max: 1, maxChars: 40, recommended: 27 },
  ],
  ctas: ["Learn More", "Sign Up"],
};
const google: NetworkSpec = {
  key: "google_display",
  fields: [{ key: "headlines", label: "Headlines", min: 1, max: 5, maxChars: 30, recommended: null }],
  ctas: [],
};

describe("checkAdCopy", () => {
  it("passes copy within every limit", () => {
    const issues = checkAdCopy([{ meta: { primary_text: "Kratko.", headline: "Učite se", cta: "Sign Up" }, google_display: { headlines: ["Ena", "Dva"] } }], [meta, google]);
    expect(issues).toEqual([]);
  });

  it("counts user-perceived characters: č and emoji are one each", () => {
    const forty = "č".repeat(39) + "👍🏽";
    expect(checkAdCopy([{ meta: { primary_text: "x", headline: forty, cta: "Sign Up" } }], [meta]).filter(isHard)).toEqual([]);
    expect(checkAdCopy([{ meta: { primary_text: "x", headline: forty + "a", cta: "Sign Up" } }], [meta])).toContainEqual(
      { variant: 0, network: "meta", field: "headline", code: "too_long", actual: 41, limit: 40 });
  });

  it("flags missing and extra texts, a CTA outside the list, banned words; a long visible part is only a warning", () => {
    const issues = checkAdCopy([
      { meta: { primary_text: "", headline: "Poceni tečaj", cta: "Buy" }, google_display: { headlines: ["1", "2", "3", "4", "5", "6"] } },
      { meta: { primary_text: "a".repeat(130), headline: "Ok", cta: "Learn More" }, google_display: { headlines: ["x".repeat(31)] } },
    ], [meta, google], ["poceni"]);
    expect(issues.map((i) => [i.variant, i.field, i.code])).toEqual([
      [0, "primary_text", "too_few"], [0, "headline", "banned_word"], [0, "cta", "bad_cta"], [0, "headlines", "too_many"],
      [1, "primary_text", "long_visible"], [1, "headlines", "too_long"],
    ]);
    expect(issues.find((i) => i.variant === 1 && i.field === "headlines")!.index).toBe(0);
    expect(issues.filter(isHard)).toHaveLength(5);
  });

  it("a network missing from a variant counts as empty", () => {
    expect(checkAdCopy([{}], [google]).map((i) => i.code)).toEqual(["too_few"]);
  });

  it("textsOf trims and drops empty entries", () => {
    expect(textsOf([" a ", "", "b"])).toEqual(["a", "b"]);
    expect(textsOf(undefined)).toEqual([]);
  });
});

describe("ad copy request", () => {
  it("writes each network's limits and CTA list into the tool; the zod shape accepts over-long text (checked later)", () => {
    const req = adCopyRequest({ brandName: "B", language: "sl", cgp: "", objective: "leads", offer: "", landingUrl: null, brief: "", networks: [meta, google], recent: [] });
    const props = (req.tool.inputSchema as { properties: { variants: { items: { properties: Record<string, { properties: Record<string, { maxLength?: number; enum?: string[]; maxItems?: number }> }> } } } }).properties.variants.items.properties;
    expect(props.meta.properties.headline.maxLength).toBe(40);
    expect(props.meta.properties.cta.enum).toEqual(["Learn More", "Sign Up"]);
    expect(props.google_display.properties.headlines.maxItems).toBe(5);
    expect(req.user).toContain("leads — a concrete reason");
    expect(adCopySchema([meta]).safeParse({ variants: [{ meta: { primary_text: "x", headline: "y".repeat(99), cta: "Nope" } }] }).success).toBe(true);
  });
});
