import { describe, expect, it } from "vitest";
import { addDays, addMonths, isIsoDate, isoWeekday, startOfWeek, stepAnchor, todayIn, viewRange } from ".";

describe("dates", () => {
  it("validates real calendar days only", () => {
    expect([isIsoDate("2026-02-28"), isIsoDate("2026-02-29"), isIsoDate("2028-02-29"), isIsoDate("2026-13-01"), isIsoDate("x"), isIsoDate(undefined)]).toEqual([true, false, true, false, false, false]);
  });

  it("today follows Ljubljana, not UTC: 23:30 UTC on 31 Dec is already 1 Jan there (and summer time)", () => {
    expect(todayIn("Europe/Ljubljana", new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(todayIn("Europe/Ljubljana", new Date("2026-06-30T22:30:00Z"))).toBe("2026-07-01");
    expect(todayIn("Europe/Ljubljana", new Date("2026-06-30T21:30:00Z"))).toBe("2026-06-30");
  });

  it("week starts on Monday; month and year boundaries; leap day", () => {
    expect(isoWeekday("2026-10-04")).toBe(7); // Sunday
    expect(startOfWeek("2026-10-04")).toBe("2026-09-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-01");
  });

  it("view ranges: month grid in whole weeks, week Mon–Sun, single day", () => {
    const m = viewRange("month", "2026-10-15"); // Oct 2026 starts Thursday, ends Saturday
    expect([m.from, m.to, m.days.length]).toEqual(["2026-09-28", "2026-11-01", 35]);
    const feb = viewRange("month", "2027-02-10"); // Feb 2027 starts Monday, 28 days → exactly 4 weeks
    expect([feb.from, feb.to, feb.days.length]).toEqual(["2027-02-01", "2027-02-28", 28]);
    expect(viewRange("week", "2026-10-04")).toMatchObject({ from: "2026-09-28", to: "2026-10-04" });
    expect(viewRange("day", "2026-10-06").days).toEqual(["2026-10-06"]);
    expect([stepAnchor("month", "2026-10-31", 1), stepAnchor("week", "2026-10-06", -1), stepAnchor("day", "2026-10-06", 1)]).toEqual(["2026-11-01", "2026-09-29", "2026-10-07"]);
  });
});
