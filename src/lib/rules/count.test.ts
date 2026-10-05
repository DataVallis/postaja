import { describe, expect, it } from "vitest";
import { emojiCount, graphemeLength, hashtags, mentions, urls, xWeightedLength } from "./count";

describe("graphemeLength", () => {
  it("counts user-perceived characters", () => {
    expect(graphemeLength("")).toBe(0);
    expect(graphemeLength("čšžćđ ČŠŽĆĐ")).toBe(11);
    expect(graphemeLength("👍🏽")).toBe(1);
    expect(graphemeLength("👨‍👩‍👧")).toBe(1);
    expect(graphemeLength("é")).toBe(1); // e + combining accent
  });
});

describe("xWeightedLength", () => {
  it("Latin and Slovenian letters weigh 1", () => expect(xWeightedLength("čšž abc")).toBe(7));
  it("emoji weigh 2, including ZWJ sequences", () => {
    expect(xWeightedLength("👍")).toBe(2);
    expect(xWeightedLength("👨‍👩‍👧")).toBe(2);
  });
  it("CJK weighs 2", () => expect(xWeightedLength("日本")).toBe(4));
  it("every URL weighs 23 regardless of length", () => {
    expect(xWeightedLength("https://a.si")).toBe(23);
    expect(xWeightedLength(`see https://example.com/${"x".repeat(200)} now`)).toBe(4 + 23 + 4);
  });
  it("exact boundary: 280 a's is 280, 140 emoji is 280", () => {
    expect(xWeightedLength("a".repeat(280))).toBe(280);
    expect(xWeightedLength("😀".repeat(140))).toBe(280);
  });
});

describe("extractors", () => {
  it("hashtags: unicode, not inside words or URLs, not pure numbers", () => {
    expect(hashtags("Gremo #AI #vibecoding #čebelarstvo a#b #123 https://x.si/#frag #ok_2")).toEqual([
      "#AI", "#vibecoding", "#čebelarstvo", "#ok_2",
    ]);
  });
  it("mentions: not emails", () => {
    expect(mentions("hi @davitacer and @inzenirji.si, mail me at a@b.si")).toEqual(["@davitacer", "@inzenirji.si"]);
  });
  it("urls and emoji", () => {
    expect(urls("a https://a.si b www.b.com c")).toEqual(["https://a.si", "www.b.com"]);
    expect(emojiCount("ok 👍 👍🏽 👨‍👩‍👧")).toBe(3);
  });
});
