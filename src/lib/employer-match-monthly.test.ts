import { describe, expect, it } from "vitest";
import { monthlyEmployerMatch, salaryAfterRealGrowth } from "./employer-match-monthly";

const tiers = [
  { matchPercent: 100, upToPercentOfSalary: 3 },
  { matchPercent: 50, upToPercentOfSalary: 2 },
];

describe("monthlyEmployerMatch", () => {
  it("returns the monthly share of the match the deferral pace earns", () => {
    // Deferring $1,667/mo is $20,004/yr, past every tier on a $100k salary, so
    // the full $4,000 match is earned: $333.33/mo.
    const r = monthlyEmployerMatch({
      monthlyDeferral: 1_667,
      annualSalary: 100_000,
      tiers,
      annualCap: null,
    });
    expect(r).toBeCloseTo(333.33, 2);
  });

  it("scales down when the deferral only reaches partway into the tiers", () => {
    // $2,000/yr deferral earns 100% of it back, so $2,000/yr = $166.67/mo.
    const r = monthlyEmployerMatch({
      monthlyDeferral: 2_000 / 12,
      annualSalary: 100_000,
      tiers,
      annualCap: null,
    });
    expect(r).toBeCloseTo(166.67, 2);
  });

  it("returns zero without a deferral", () => {
    expect(
      monthlyEmployerMatch({ monthlyDeferral: 0, annualSalary: 100_000, tiers, annualCap: null }),
    ).toBe(0);
  });

  it("returns zero when no tiers are configured", () => {
    expect(
      monthlyEmployerMatch({
        monthlyDeferral: 1_000,
        annualSalary: 100_000,
        tiers: [],
        annualCap: null,
      }),
    ).toBe(0);
  });

  it("returns zero when salary is unset, since tiers are salary-relative", () => {
    expect(
      monthlyEmployerMatch({ monthlyDeferral: 1_000, annualSalary: 0, tiers, annualCap: null }),
    ).toBe(0);
  });

  it("respects an annual cap", () => {
    // Full tiers would pay $4,000; the cap holds it to $1,200/yr = $100/mo.
    const r = monthlyEmployerMatch({
      monthlyDeferral: 1_667,
      annualSalary: 100_000,
      tiers,
      annualCap: 1_200,
    });
    expect(r).toBeCloseTo(100, 2);
  });

  it("ignores negative deferrals rather than paying a negative match", () => {
    expect(
      monthlyEmployerMatch({ monthlyDeferral: -500, annualSalary: 100_000, tiers, annualCap: null }),
    ).toBe(0);
  });
});

describe("salaryAfterRealGrowth", () => {
  it("holds salary flat at a zero growth rate", () => {
    expect(salaryAfterRealGrowth(100_000, 0, 120)).toBe(100_000);
  });

  it("holds salary flat at month zero", () => {
    expect(salaryAfterRealGrowth(100_000, 1.5, 0)).toBe(100_000);
  });

  it("compounds a real raise across whole years", () => {
    // 2% real for 10 years is 100000 * 1.02^10.
    expect(salaryAfterRealGrowth(100_000, 2, 120)).toBeCloseTo(121_899.44, 2);
  });

  it("compounds fractionally within a year rather than stepping once a year", () => {
    const halfway = salaryAfterRealGrowth(100_000, 2, 6);
    expect(halfway).toBeGreaterThan(100_000);
    expect(halfway).toBeLessThan(102_000);
  });

  it("shrinks salary in real terms when raises trail inflation", () => {
    expect(salaryAfterRealGrowth(100_000, -1, 120)).toBeLessThan(100_000);
  });
});
