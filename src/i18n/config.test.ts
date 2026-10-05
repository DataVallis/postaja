import { describe, expect, it } from "vitest";
import { resolveLocale } from "./config";
import sl from "../../messages/sl.json";
import en from "../../messages/en.json";

describe("resolveLocale", () => {
  it("returns a supported locale unchanged", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("sl")).toBe("sl");
  });
  it("falls back to sl for missing, empty or unknown values", () => {
    expect(resolveLocale(undefined)).toBe("sl");
    expect(resolveLocale("")).toBe("sl");
    expect(resolveLocale("de")).toBe("sl");
    expect(resolveLocale("EN")).toBe("sl");
  });
});

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("messages", () => {
  it("sl and en have exactly the same keys", () => {
    expect(keys(en).sort()).toEqual(keys(sl).sort());
  });
});
