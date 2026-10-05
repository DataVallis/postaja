import { describe, expect, it } from "vitest";
import { normalizeEmail, parseEmailList } from "./emails";
import { canSignUp } from "./auth";

describe("parseEmailList", () => {
  it("splits on commas and whitespace, lower-cases, trims, dedupes", () => {
    expect([...parseEmailList(" A@x.si, b@y.com  a@X.si\nc@z.io ")]).toEqual(["a@x.si", "b@y.com", "c@z.io"]);
  });
  it("is empty for undefined, empty or junk", () => {
    expect(parseEmailList(undefined).size).toBe(0);
    expect(parseEmailList("").size).toBe(0);
    expect(parseEmailList(" , ,notanemail").size).toBe(0);
  });
});

describe("canSignUp", () => {
  const deps = { superadminEmails: parseEmailList("boss@datavallis.com") };
  it("allows a superadmin email regardless of case and spaces", () => {
    expect(canSignUp("  Boss@DataVallis.com ", deps)).toBe(true);
  });
  it("rejects everyone else", () => {
    expect(canSignUp("boss@datavallis.co", deps)).toBe(false);
    expect(canSignUp("", deps)).toBe(false);
  });
  it("normalizeEmail", () => expect(normalizeEmail(" X@Y.Z ")).toBe("x@y.z"));
});
