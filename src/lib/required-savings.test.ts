import { describe, expect, it } from "vitest";
import { computeRequiredSavings } from "./required-savings";

const base = {
  target: 1_000_000,
  startingBalance: 100_000,
  monthsToRetirement: 360,
  realAnnualReturn: 4,
  currentMonthly: 1_000,
  annualSalary: 100_000,
};

describe("computeRequiredSavings", () => {
  it("returns a positive required monthly contribution when short of target", () => {
    const r = computeRequiredSavings(base);
    expect(r.requiredMonthly).toBeGreaterThan(0);
  });

  it("reports the shortfall against current contributions", () => {
    const r = computeRequiredSavings(base);
    expect(r.shortfallMonthly).toBeCloseTo(r.requiredMonthly - base.currentMonthly, 2);
  });

  it("reports on track with zero shortfall when contributing enough", () => {
    const r = computeRequiredSavings({ ...base, currentMonthly: 10_000 });
    expect(r.onTrack).toBe(true);
    expect(r.shortfallMonthly).toBe(0);
  });

  it("requires nothing when the starting balance already grows past the target", () => {
    const r = computeRequiredSavings({ ...base, startingBalance: 900_000 });
    expect(r.requiredMonthly).toBe(0);
    expect(r.onTrack).toBe(true);
  });

  it("expresses the requirement as a percentage of salary", () => {
    const r = computeRequiredSavings(base);
    expect(r.percentOfSalary).toBeCloseTo((r.requiredMonthly * 12 * 100) / base.annualSalary, 6);
  });

  it("returns a null salary percentage when salary is zero", () => {
    const r = computeRequiredSavings({ ...base, annualSalary: 0 });
    expect(r.percentOfSalary).toBeNull();
  });

  it("handles a zero real return without dividing by zero", () => {
    const r = computeRequiredSavings({ ...base, realAnnualReturn: 0 });
    expect(Number.isFinite(r.requiredMonthly)).toBe(true);
    // With no growth, the gap is simply spread across the months.
    expect(r.requiredMonthly).toBeCloseTo((1_000_000 - 100_000) / 360, 2);
  });

  it("returns zero requirement when already at retirement", () => {
    const r = computeRequiredSavings({ ...base, monthsToRetirement: 0 });
    expect(r.requiredMonthly).toBe(0);
  });

  it("matches a hand-computed annuity payment", () => {
    // FV of annuity: target 100000, no starting balance, 120 months, 0% return
    // means exactly 100000/120 per month.
    const r = computeRequiredSavings({
      target: 100_000,
      startingBalance: 0,
      monthsToRetirement: 120,
      realAnnualReturn: 0,
      currentMonthly: 0,
      annualSalary: 0,
    });
    expect(r.requiredMonthly).toBeCloseTo(833.33, 2);
  });
});
