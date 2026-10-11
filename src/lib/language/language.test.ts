import { describe, expect, it } from "vitest";
import { languageName, postLanguage } from ".";

describe("postLanguage", () => {
  it("uses the channel's language when the brand has it, else the brand's first language", () => {
    expect(postLanguage("en", ["sl", "en"])).toBe("en");
    expect(postLanguage("sl", ["en"])).toBe("en"); // aibuilders.si: channel left on the "sl" default, brand is English
    expect(postLanguage(null, ["de"])).toBe("de");
    expect(postLanguage("sl", [])).toBe("sl");
    expect(languageName("en")).toBe("English");
  });
});
