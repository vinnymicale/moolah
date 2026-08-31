import { describe, expect, it } from "vitest";
import { computeRetirementTarget } from "./retirement-target";
import type { RetirementAssumptions } from "./retirement-types";

const base = (over: Partial<RetirementAssumptions> = {}): RetirementAssumptions => ({
  birthYear: 1990,
  targetRetirementAge: 65,
  expectedReturn: 7,
  inflationRate: 3,
  incomeReplacementRatio: 80,
  safeWithdrawalRate: 4,
  expectedSocialSecurityMonthly: 0,
  currentAnnualSalary: 100_000,
  salaryGrowthRate: 0,
  filingStatus: "SINGLE",
  ...over,
});

describe("computeRetirementTarget", () => {
  it("applies the replacement ratio to salary", () => {
    const r = computeRetirementTarget(base());
    expect(r.annualNeed).toBe(80_000);
  });

  it("divides the portfolio need by the safe withdrawal rate", () => {
    // $80k need at a 4% withdrawal rate is a $2M portfolio.
    const r = computeRetirementTarget(base());
    expect(r.annualFromPortfolio).toBe(80_000);
    expect(r.target).toBe(2_000_000);
  });

  it("subtracts Social Security from the portfolio need", () => {
    // $80k need less $24k of benefits leaves $56k from the portfolio.
    const r = computeRetirementTarget(base({ expectedSocialSecurityMonthly: 2_000 }));
    expect(r.annualFromSocialSecurity).toBe(24_000);
    expect(r.annualFromPortfolio).toBe(56_000);
    expect(r.target).toBe(1_400_000);
  });

  it("floors the portfolio need at zero when benefits exceed the need", () => {
    const r = computeRetirementTarget(base({ expectedSocialSecurityMonthly: 10_000 }));
    expect(r.annualFromPortfolio).toBe(0);
    expect(r.target).toBe(0);
  });

  it("returns zero when salary is unset", () => {
    const r = computeRetirementTarget(base({ currentAnnualSalary: 0 }));
    expect(r.target).toBe(0);
  });

  it("returns zero rather than Infinity when the withdrawal rate is zero", () => {
    const r = computeRetirementTarget(base({ safeWithdrawalRate: 0 }));
    expect(Number.isFinite(r.target)).toBe(true);
    expect(r.target).toBe(0);
  });
});
