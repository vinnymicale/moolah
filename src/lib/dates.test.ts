import { describe, it, expect } from "vitest";
import { afterEach, vi } from "vitest";
import {
  parseISODay, isoDay, toUTCDay, addUTCDays, addUTCMonths, addUTCYears,
  daysInMonth, startOfUTCMonth, endOfUTCMonth, daysBetween, daysUntilDate, monthGrid,
  sameUTCDay, isBefore, isAfter, withinRange, monthLabel,
  formatMonthDay, formatMonthDayYear, formatWeekdayMonthDay, formatWeekdayMonthDayYear,
} from "./dates";

describe("parseISODay / isoDay", () => {
  it("round-trips a calendar day at midnight UTC", () => {
    const d = parseISODay("2026-06-09");
    expect(d.toISOString()).toBe("2026-06-09T00:00:00.000Z");
    expect(isoDay(d)).toBe("2026-06-09");
  });

  it("toUTCDay strips the time component", () => {
    expect(isoDay(toUTCDay(new Date("2026-06-09T23:59:59Z")))).toBe("2026-06-09");
  });
});

describe("addUTCMonths", () => {
  it("clamps to the last day of shorter months", () => {
    expect(isoDay(addUTCMonths(parseISODay("2026-01-31"), 1))).toBe("2026-02-28");
    expect(isoDay(addUTCMonths(parseISODay("2024-01-31"), 1))).toBe("2024-02-29"); // leap year
    expect(isoDay(addUTCMonths(parseISODay("2026-03-31"), 1))).toBe("2026-04-30");
  });

  it("crosses year boundaries in both directions", () => {
    expect(isoDay(addUTCMonths(parseISODay("2026-11-15"), 3))).toBe("2027-02-15");
    expect(isoDay(addUTCMonths(parseISODay("2026-02-15"), -3))).toBe("2025-11-15");
  });

  it("addUTCYears is 12 months", () => {
    expect(isoDay(addUTCYears(parseISODay("2024-02-29"), 1))).toBe("2025-02-28");
  });
});

describe("month boundaries", () => {
  it("start and end of month", () => {
    const d = parseISODay("2026-06-09");
    expect(isoDay(startOfUTCMonth(d))).toBe("2026-06-01");
    expect(isoDay(endOfUTCMonth(d))).toBe("2026-06-30");
  });

  it("daysInMonth handles leap February", () => {
    expect(daysInMonth(2024, 1)).toBe(29);
    expect(daysInMonth(2026, 1)).toBe(28);
  });
});

describe("daysBetween", () => {
  it("is signed and ignores time-of-day", () => {
    expect(daysBetween(parseISODay("2026-06-01"), parseISODay("2026-06-09"))).toBe(8);
    expect(daysBetween(parseISODay("2026-06-09"), parseISODay("2026-06-01"))).toBe(-8);
    expect(daysBetween(new Date("2026-06-01T23:00:00Z"), new Date("2026-06-02T01:00:00Z"))).toBe(1);
  });
});

describe("monthGrid", () => {
  it("returns a 42-day grid starting on Sunday and covering the month", () => {
    const grid = monthGrid(parseISODay("2026-06-09"));
    expect(grid).toHaveLength(42);
    expect(grid[0].getUTCDay()).toBe(0);
    // June 2026 starts Monday, so the grid starts Sunday May 31.
    expect(isoDay(grid[0])).toBe("2026-05-31");
    expect(isoDay(grid[41])).toBe("2026-07-11");
  });
});

describe("addUTCDays", () => {
  it("adds and subtracts, crossing month boundaries", () => {
    expect(isoDay(addUTCDays(parseISODay("2026-06-30"), 2))).toBe("2026-07-02");
    expect(isoDay(addUTCDays(parseISODay("2026-06-01"), -1))).toBe("2026-05-31");
  });
});

describe("comparisons", () => {
  const a = parseISODay("2026-06-01");
  const b = parseISODay("2026-06-09");

  it("sameUTCDay ignores time-of-day", () => {
    expect(sameUTCDay(new Date("2026-06-09T00:00:00Z"), new Date("2026-06-09T23:59:59Z"))).toBe(true);
    expect(sameUTCDay(a, b)).toBe(false);
  });

  it("isBefore / isAfter order two days", () => {
    expect(isBefore(a, b)).toBe(true);
    expect(isBefore(b, a)).toBe(false);
    expect(isAfter(b, a)).toBe(true);
    expect(isAfter(a, b)).toBe(false);
  });

  it("withinRange is inclusive on both ends", () => {
    expect(withinRange(a, a, b)).toBe(true);
    expect(withinRange(b, a, b)).toBe(true);
    expect(withinRange(parseISODay("2026-06-05"), a, b)).toBe(true);
    expect(withinRange(parseISODay("2026-05-31"), a, b)).toBe(false);
    expect(withinRange(parseISODay("2026-06-10"), a, b)).toBe(false);
  });
});

describe("daysUntilDate", () => {
  afterEach(() => vi.useRealTimers());

  it("is positive for the future, negative once past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T12:00:00Z"));
    expect(daysUntilDate("2026-06-12")).toBe(3);
    expect(daysUntilDate("2026-06-05")).toBe(-4);
  });
});

describe("monthLabel", () => {
  it("renders the UTC month and year", () => {
    expect(monthLabel(parseISODay("2026-06-09"))).toBe("June 2026");
    expect(monthLabel(parseISODay("2026-01-01"))).toBe("January 2026");
  });
});

describe("formatters render the stored day regardless of zone", () => {
  it("formats month/day and full date", () => {
    expect(formatMonthDay("2026-06-09")).toBe("Jun 9");
    expect(formatMonthDayYear("2026-06-09")).toBe("Jun 9, 2026");
  });

  it("formats weekday variants", () => {
    expect(formatWeekdayMonthDay("2026-06-09")).toBe("Tue, Jun 9");
    expect(formatWeekdayMonthDayYear("2026-06-09")).toBe("Tue, Jun 9, 2026");
  });

  it("returns an empty string for an empty input", () => {
    expect(formatMonthDay("")).toBe("");
    expect(formatWeekdayMonthDayYear("")).toBe("");
  });
});
