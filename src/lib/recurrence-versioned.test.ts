import { describe, it, expect } from "vitest";
import { expandOccurrences, expandVersioned, currentVersion } from "./recurrence";
import { isoDay, parseISODay } from "./dates";

const d = parseISODay;

interface V {
  effectiveFrom: string;
  amount: number;
  frequency: "MONTHLY" | "WEEKLY" | "BIWEEKLY" | "YEARLY" | "DAILY";
  interval?: number;
  startDate: string;
  endDate?: string | null;
  dayOfMonth?: number | null;
}

const rent = (over: Partial<V>): V => ({
  effectiveFrom: "2026-01-01",
  amount: 2300,
  frequency: "MONTHLY",
  startDate: "2026-01-05",
  dayOfMonth: 5,
  ...over,
});

const days = (out: { date: Date }[]) => out.map((o) => isoDay(o.date));

describe("expandVersioned", () => {
  it("matches expandOccurrences for a single version", () => {
    const v = rent({});
    const versioned = expandVersioned([v], d("2026-01-01"), d("2026-06-30"));
    expect(days(versioned)).toEqual(
      expandOccurrences(v, d("2026-01-01"), d("2026-06-30")).map(isoDay),
    );
  });

  it("returns the amount in force on each date", () => {
    const out = expandVersioned(
      [rent({}), rent({ effectiveFrom: "2026-05-05", amount: 2450 })],
      d("2026-01-01"),
      d("2026-08-31"),
    );
    const byDay = new Map(out.map((o) => [isoDay(o.date), o.version.amount]));
    expect(byDay.get("2026-03-05")).toBe(2300);
    expect(byDay.get("2026-05-05")).toBe(2450);
    expect(byDay.get("2026-08-05")).toBe(2450);
  });

  it("gives a boundary day to the newer version, exactly once", () => {
    const out = expandVersioned(
      [rent({}), rent({ effectiveFrom: "2026-05-05", amount: 2450 })],
      d("2026-05-01"),
      d("2026-05-31"),
    );
    expect(days(out)).toEqual(["2026-05-05"]);
    expect(out[0].version.amount).toBe(2450);
  });

  it("charges twice in September when the 5th-to-10th move lands mid-month", () => {
    const out = expandVersioned(
      [rent({}), rent({ effectiveFrom: "2026-09-10", dayOfMonth: 10, startDate: "2026-09-10" })],
      d("2026-09-01"),
      d("2026-09-30"),
    );
    expect(days(out)).toEqual(["2026-09-05", "2026-09-10"]);
  });

  it("charges once in September when the move takes effect on the next occurrence", () => {
    const out = expandVersioned(
      [rent({}), rent({ effectiveFrom: "2026-09-05", dayOfMonth: 10, startDate: "2026-09-10" })],
      d("2026-09-01"),
      d("2026-10-31"),
    );
    expect(days(out)).toEqual(["2026-09-10", "2026-10-10"]);
  });

  it("leaves a gap when a version ends before its successor takes effect", () => {
    const out = expandVersioned(
      [
        rent({ endDate: "2026-03-31" }),
        rent({ effectiveFrom: "2026-06-05", startDate: "2026-06-05" }),
      ],
      d("2026-01-01"),
      d("2026-07-31"),
    );
    expect(days(out)).toEqual([
      "2026-01-05",
      "2026-02-05",
      "2026-03-05",
      "2026-06-05",
      "2026-07-05",
    ]);
  });

  it("sorts unsorted input", () => {
    const out = expandVersioned(
      [rent({ effectiveFrom: "2026-05-05", amount: 2450 }), rent({})],
      d("2026-04-01"),
      d("2026-05-31"),
    );
    expect(days(out)).toEqual(["2026-04-05", "2026-05-05"]);
    expect(out[0].version.amount).toBe(2300);
  });
});

describe("currentVersion", () => {
  const versions = [rent({}), rent({ effectiveFrom: "2026-05-05", amount: 2450 })];

  it("picks the version in force on the given date", () => {
    expect(currentVersion(versions, d("2026-04-30")).amount).toBe(2300);
    expect(currentVersion(versions, d("2026-05-05")).amount).toBe(2450);
  });

  it("falls back to the earliest version before the series began", () => {
    expect(currentVersion(versions, d("2025-01-01")).amount).toBe(2300);
  });
});
