import { describe, expect, it } from "vitest";
import { microToUsd, usdToMicro } from "./usd";

describe("usdToMicro", () => {
  it.each([
    ["0", 0n], ["50", 50_000_000n], ["12.5", 12_500_000n], ["12,5", 12_500_000n],
    ["0.000001", 1n], ["0.999999", 999_999n], [" 3 ", 3_000_000n], ["1000000", 1_000_000_000_000n],
  ])("%s → %s", (input, out) => expect(usdToMicro(input)).toBe(out));

  it.each(["", "-1", "1e3", "0.0000001", "abc", "1.2.3", ".5", "1000000.000001", "12345678"])("rejects %j", (input) => {
    expect(() => usdToMicro(input)).toThrow();
  });
});

describe("microToUsd", () => {
  it.each([
    [0n, "0.00"], [50_000_000n, "50.00"], [12_345_000n, "12.35"], [12_344_999n, "12.34"], [1n, "0.00"], [5_000n, "0.01"], [-1_500_000n, "-1.50"],
  ])("%s → %s", (m, out) => expect(microToUsd(m)).toBe(out));
});
