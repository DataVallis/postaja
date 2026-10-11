import { describe, expect, it } from "vitest";
import { daysBetween, isDueForReverification, REVERIFY_AFTER_DAYS, todayIso } from "./verification";

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("quarterly re-verification", () => {
  it("is 90 days", () => {
    expect(REVERIFY_AFTER_DAYS).toBe(90);
  });

  it("exact boundary: 89 days fine, 90 and 91 due", () => {
    // 2026-07-07 + 90 days = 2026-10-05
    expect(daysBetween("2026-07-07", "2026-10-05")).toBe(90);
    expect(isDueForReverification("2026-07-08", at("2026-10-05"))).toBe(false); // 89
    expect(isDueForReverification("2026-07-07", at("2026-10-05"))).toBe(true); // 90
    expect(isDueForReverification("2026-07-06", at("2026-10-05"))).toBe(true); // 91
  });

  it("verified today (0 days) is not due", () => {
    expect(isDueForReverification("2026-10-05", at("2026-10-05"))).toBe(false);
  });

  it("counts across DST changes and leap years in whole days", () => {
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2); // EU DST switch on 2026-03-29
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2); // leap year
  });

  it("today is the UTC date", () => {
    expect(todayIso(new Date("2026-10-05T23:30:00+02:00"))).toBe("2026-10-05");
    expect(todayIso(new Date("2026-10-06T01:30:00+02:00"))).toBe("2026-10-05");
  });
});
