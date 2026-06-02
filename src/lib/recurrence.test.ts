import { describe, it, expect } from "vitest";
import { expandOccurrences, describeFrequency, type RuleLike } from "./recurrence";
import { isoDay } from "./dates";

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const days = (ds: Date[]) => ds.map(isoDay);

describe("expandOccurrences", () => {
  it("daily, every day within range", () => {
    const rule: RuleLike = { frequency: "DAILY", startDate: D("2026-01-01") };
    const out = expandOccurrences(rule, D("2026-01-01"), D("2026-01-04"));
    expect(days(out)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]);
  });

  it("daily with interval 3", () => {
    const rule: RuleLike = { frequency: "DAILY", interval: 3, startDate: D("2026-01-01") };
    const out = expandOccurrences(rule, D("2026-01-01"), D("2026-01-10"));
    expect(days(out)).toEqual(["2026-01-01", "2026-01-04", "2026-01-07", "2026-01-10"]);
  });

  it("daily fast-forwards when window starts after rule start", () => {
    const rule: RuleLike = { frequency: "DAILY", interval: 2, startDate: D("2026-01-01") };
    const out = expandOccurrences(rule, D("2026-01-06"), D("2026-01-10"));
    // start 1,3,5,7,9 -> within [6,10] => 7, 9
    expect(days(out)).toEqual(["2026-01-07", "2026-01-09"]);
  });

  it("weekly keeps the same weekday", () => {
    // 2026-01-01 is a Thursday.
    const rule: RuleLike = { frequency: "WEEKLY", startDate: D("2026-01-01") };
    const out = expandOccurrences(rule, D("2026-01-01"), D("2026-01-31"));
    expect(days(out)).toEqual(["2026-01-01", "2026-01-08", "2026-01-15", "2026-01-22", "2026-01-29"]);
  });

  it("biweekly steps by 14 days", () => {
    const rule: RuleLike = { frequency: "BIWEEKLY", startDate: D("2026-01-02") };
    const out = expandOccurrences(rule, D("2026-01-01"), D("2026-02-28"));
    expect(days(out)).toEqual(["2026-01-02", "2026-01-16", "2026-01-30", "2026-02-13", "2026-02-27"]);
  });

  it("weekly honours an explicit weekday anchor", () => {
    // start Thursday 2026-01-01, anchor weekday = 1 (Monday) -> first Monday 2026-01-05
    const rule: RuleLike = { frequency: "WEEKLY", startDate: D("2026-01-01"), weekday: 1 };
    const out = expandOccurrences(rule, D("2026-01-01"), D("2026-01-20"));
    expect(days(out)).toEqual(["2026-01-05", "2026-01-12", "2026-01-19"]);
  });

  it("monthly on the 15th", () => {
    const rule: RuleLike = { frequency: "MONTHLY", startDate: D("2026-01-15") };
    const out = expandOccurrences(rule, D("2026-01-01"), D("2026-04-30"));
    expect(days(out)).toEqual(["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15"]);
  });

  it("monthly clamps day 31 to short months", () => {
    const rule: RuleLike = { frequency: "MONTHLY", startDate: D("2026-01-31") };
    const out = expandOccurrences(rule, D("2026-01-01"), D("2026-04-30"));
    // Feb clamps to 28 (2026 not a leap year), Apr to 30.
    expect(days(out)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("monthly with interval 2 (every other month)", () => {
    const rule: RuleLike = { frequency: "MONTHLY", interval: 2, startDate: D("2026-01-10") };
    const out = expandOccurrences(rule, D("2026-01-01"), D("2026-06-30"));
    expect(days(out)).toEqual(["2026-01-10", "2026-03-10", "2026-05-10"]);
  });

  it("yearly", () => {
    const rule: RuleLike = { frequency: "YEARLY", startDate: D("2024-02-29") };
    const out = expandOccurrences(rule, D("2024-01-01"), D("2027-12-31"));
    // 2024 leap -> 29th; non-leap years clamp to 28th.
    expect(days(out)).toEqual(["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28"]);
  });

  it("respects endDate", () => {
    const rule: RuleLike = {
      frequency: "MONTHLY",
      startDate: D("2026-01-01"),
      endDate: D("2026-03-01"),
    };
    const out = expandOccurrences(rule, D("2026-01-01"), D("2026-12-31"));
    expect(days(out)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });

  it("returns nothing when the window precedes the start", () => {
    const rule: RuleLike = { frequency: "DAILY", startDate: D("2026-05-01") };
    const out = expandOccurrences(rule, D("2026-01-01"), D("2026-01-31"));
    expect(out).toEqual([]);
  });
});

describe("describeFrequency", () => {
  it("formats common cases", () => {
    expect(describeFrequency("MONTHLY")).toBe("Every month");
    expect(describeFrequency("BIWEEKLY")).toBe("Every 2 weeks");
    expect(describeFrequency("WEEKLY", 2)).toBe("Every 2 weeks");
    expect(describeFrequency("DAILY", 3)).toBe("Every 3 days");
    expect(describeFrequency("YEARLY", 1)).toBe("Every year");
  });
});
