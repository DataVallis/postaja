import { describe, expect, it } from "vitest";
import { checkCarousel, checkText, checkThread, effectiveRules, type RuleSet } from "./rules";

const ig: RuleSet = { counting: "graphemes", captionMax: 2200, visibleChars: 125, hashtagsMax: 5, linksAllowed: true, slidesMin: 2, slidesMax: 10 };
const x: RuleSet = { counting: "x_weighted", captionMax: 280, threadPartMax: 280, threadPartsMax: 25 };
const codes = (r: { violations: { code: string }[] }) => r.violations.map((v) => v.code);

describe("effectiveRules — most strict wins", () => {
  it("numeric limits take the minimum across layers; undefined layers are ignored", () => {
    const r = effectiveRules(ig, { hashtagsMax: 3 }, undefined, { hashtagsMax: 10, captionMax: 1000 });
    expect(r.hashtagsMax).toBe(3);
    expect(r.captionMax).toBe(1000);
  });
  it("a looser layer never relaxes the platform", () => {
    expect(effectiveRules(ig, { captionMax: 5000, hashtagsMax: 30 })).toMatchObject({ captionMax: 2200, hashtagsMax: 5 });
  });
  it("linksAllowed false in any layer wins; slidesMin takes the maximum; lists are unioned", () => {
    const r = effectiveRules(ig, { linksAllowed: false, slidesMin: 4, bannedWords: ["poceni"] }, { linksAllowed: true, bannedWords: ["poceni", "garancija"] });
    expect(r.linksAllowed).toBe(false);
    expect(r.slidesMin).toBe(4);
    expect(r.bannedWords).toEqual(["poceni", "garancija"]);
  });
  it("counting cannot be overridden", () => {
    expect(effectiveRules(x, { counting: "graphemes" }).counting).toBe("x_weighted");
  });
});

describe("checkText — exact boundaries", () => {
  it("caption: limit passes, limit+1 fails with actual/limit", () => {
    expect(codes(checkText("a".repeat(2200), ig))).toEqual([]);
    expect(checkText("a".repeat(2201), ig).violations).toEqual([{ code: "caption_too_long", actual: 2201, limit: 2200 }]);
  });
  it("diacritics count as one character each", () => {
    expect(codes(checkText("č".repeat(2200), ig))).toEqual([]);
  });
  it("X counting: 280 passes, 281 fails; a long URL counts 23", () => {
    expect(codes(checkText("a".repeat(280), x))).toEqual([]);
    expect(codes(checkText("a".repeat(281), x))).toEqual(["caption_too_long"]);
    expect(codes(checkText("a".repeat(256) + " https://example.com/" + "x".repeat(500), x))).toEqual([]); // 256+1+23 = 280
  });
  it("hashtags: 5 pass, 6 fail; preview truncation is only a warning", () => {
    expect(codes(checkText("#a1 #b #c #d #e", ig))).toEqual([]);
    expect(checkText("#a1 #b #c #d #e #f", ig).violations).toEqual([{ code: "too_many_hashtags", actual: 6, limit: 5 }]);
    const r = checkText("a".repeat(126), ig);
    expect(r.violations).toEqual([]);
    expect(r.warnings).toEqual([{ code: "truncated_preview", actual: 126, limit: 125 }]);
  });
  it("links not allowed; banned words whole-word, case-insensitive, with diacritics", () => {
    const rules = effectiveRules(ig, { linksAllowed: false, bannedWords: ["poceni", "čudež"] });
    expect(codes(checkText("Obišči https://a.si", rules))).toEqual(["links_not_allowed"]);
    expect(codes(checkText("Pravi ČUDEŽ!", rules))).toEqual(["banned_word"]);
    expect(codes(checkText("Pocenitev cen", rules))).toEqual([]); // not a whole word
  });
  it("regex rules and CTA at the end", () => {
    const rules = effectiveRules(ig, { regexMust: ["inzenirji\\.si"], regexMustNot: ["!!+"], mustEndWithCta: true });
    expect(codes(checkText("Super!! novica", rules, ["link v bio"]))).toEqual(["regex_must", "regex_must_not", "missing_cta"]);
    expect(codes(checkText("Več na inzenirji.si\nLink v bio.", rules, ["link v bio"]))).toEqual([]);
  });
  it("empty text passes when no minimums exist", () => {
    expect(checkText("", ig)).toEqual({ violations: [], warnings: [] });
  });
});

describe("checkThread / checkCarousel", () => {
  it("thread: per-part limit with part number, parts maximum exact", () => {
    expect(checkThread(["a".repeat(280), "b".repeat(281)], x)).toEqual([{ code: "thread_part_too_long", actual: 281, limit: 280, part: 2 }]);
    expect(checkThread(Array(25).fill("a"), x)).toEqual([]);
    expect(checkThread(Array(26).fill("a"), x)).toEqual([{ code: "too_many_thread_parts", actual: 26, limit: 25 }]);
  });
  it("carousel: 2..10 inclusive", () => {
    expect(checkCarousel(1, ig)).toEqual([{ code: "too_few_slides", actual: 1, limit: 2 }]);
    expect(checkCarousel(2, ig)).toEqual([]);
    expect(checkCarousel(10, ig)).toEqual([]);
    expect(checkCarousel(11, ig)).toEqual([{ code: "too_many_slides", actual: 11, limit: 10 }]);
  });
});
