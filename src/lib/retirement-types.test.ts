import { describe, expect, it } from "vitest";
import {
  monthlyRateFromAnnual,
  matchTiersSchema,
  percentScheduleAmount,
  OCCURRENCES_PER_YEAR,
} from "./retirement-types";

describe("monthlyRateFromAnnual", () => {
  it("compounds to the annual rate over twelve months", () => {
    const monthly = monthlyRateFromAnnual(7);
    expect(Math.pow(1 + monthly, 12) - 1).toBeCloseTo(0.07, 10);
  });

  it("is lower than the naive annual/12 division", () => {
    expect(monthlyRateFromAnnual(7)).toBeLessThan(0.07 / 12);
  });

  it("returns zero for a zero rate", () => {
    expect(monthlyRateFromAnnual(0)).toBe(0);
  });

  it("handles negative returns", () => {
    const monthly = monthlyRateFromAnnual(-10);
    expect(monthly).toBeLessThan(0);
    expect(Math.pow(1 + monthly, 12) - 1).toBeCloseTo(-0.1, 10);
  });
});

describe("matchTiersSchema", () => {
  it("accepts a valid tiered formula", () => {
    const tiers = [
      { matchPercent: 100, upToPercentOfSalary: 3 },
      { matchPercent: 50, upToPercentOfSalary: 2 },
    ];
    expect(matchTiersSchema.parse(tiers)).toEqual(tiers);
  });

  it("rejects a negative match percent", () => {
    expect(() => matchTiersSchema.parse([{ matchPercent: -1, upToPercentOfSalary: 3 }])).toThrow();
  });

  it("rejects a tier covering zero percent of salary", () => {
    expect(() => matchTiersSchema.parse([{ matchPercent: 100, upToPercentOfSalary: 0 }])).toThrow();
  });
});

describe("percentScheduleAmount", () => {
  it("annualises back to the exact salary percentage", () => {
    const perPaycheck = percentScheduleAmount({
      percentOfSalary: 6,
      annualSalary: 115_000,
      frequency: "BIWEEKLY",
      interval: 1,
    });
    // Rounding this to cents would read back as 5.9998% and trigger a bogus
    // "you're leaving match on the table" warning.
    expect(perPaycheck * OCCURRENCES_PER_YEAR.BIWEEKLY).toBeCloseTo(6_900, 10);
  });

  it("halves the per-occurrence amount when the interval doubles", () => {
    const every = percentScheduleAmount({
      percentOfSalary: 6,
      annualSalary: 100_000,
      frequency: "MONTHLY",
      interval: 1,
    });
    const other = percentScheduleAmount({
      percentOfSalary: 6,
      annualSalary: 100_000,
      frequency: "MONTHLY",
      interval: 2,
    });
    expect(other).toBeCloseTo(every * 2, 10);
  });

  it("contributes nothing without a salary on file", () => {
    expect(
      percentScheduleAmount({
        percentOfSalary: 6,
        annualSalary: 0,
        frequency: "BIWEEKLY",
        interval: 1,
      }),
    ).toBe(0);
  });

  it("contributes nothing at a zero percent", () => {
    expect(
      percentScheduleAmount({
        percentOfSalary: 0,
        annualSalary: 100_000,
        frequency: "MONTHLY",
        interval: 1,
      }),
    ).toBe(0);
  });
});
