import { describe, expect, it } from "vitest";
import { monthlyRateFromAnnual, matchTiersSchema } from "./retirement-types";

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
