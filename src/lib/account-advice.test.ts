import { describe, it, expect } from "vitest";
import { buildAccountAdvice, type AdviceInput } from "./account-advice";
import type { MatchResult } from "./contribution-limits";

function base(over: Partial<AdviceInput> = {}): AdviceInput {
  return {
    age: 35,
    currentAnnualSalary: 90_000,
    incomeReplacementRatio: 80,
    filingStatus: "SINGLE",
    taxYear: 2026,
    annualContribution: 10_000,
    match: null,
    hasWorkplacePlan: true,
    hasIra: true,
    ...over,
  };
}

function match(over: Partial<MatchResult> = {}): MatchResult {
  return {
    maxAnnualMatch: 4_500,
    projectedMatch: 4_500,
    forfeited: 0,
    forfeitureIsMaterial: false,
    capturedPercent: 100,
    deferralPercentToMaxMatch: 6,
    currentDeferralPercent: 6,
    tiers: [],
    ...over,
  };
}

describe("buildAccountAdvice", () => {
  it("puts an unclaimed employer match ahead of everything else", () => {
    const advice = buildAccountAdvice(
      base({ match: match({ projectedMatch: 2_250, forfeited: 2_250, forfeitureIsMaterial: true, currentDeferralPercent: 3 }) }),
    );
    expect(advice.steps[0].key).toBe("match");
    expect(advice.steps[0].priority).toBe("critical");
    expect(advice.steps[0].amount).toBe(2_250);
    expect(advice.steps[0].title).toContain("6.0%");
  });

  it("does not nag when the shortfall is only payroll rounding", () => {
    // forfeited is a few cents but forfeitureIsMaterial is false.
    const advice = buildAccountAdvice(base({ match: match({ forfeited: 0.04 }) }));
    expect(advice.steps[0].key).toBe("match-ok");
    expect(advice.steps.some((s) => s.key === "match")).toBe(false);
  });

  it("leans Roth in a low bracket regardless of the retirement rate", () => {
    const advice = buildAccountAdvice(base({ currentAnnualSalary: 38_000, annualContribution: 2_000 }));
    expect(advice.currentMarginalRate).toBe(12);
    expect(advice.lean).toBe("ROTH");
    expect(advice.leanReason).toMatch(/tax-free growth/i);
  });

  it("leans traditional at a high marginal rate", () => {
    const advice = buildAccountAdvice(base({ currentAnnualSalary: 260_000, age: 45, annualContribution: 10_000 }));
    expect(advice.currentMarginalRate).toBeGreaterThanOrEqual(32);
    expect(advice.lean).toBe("TRADITIONAL");
  });

  it("splits when today's rate and the retirement rate are close", () => {
    const advice = buildAccountAdvice(base({ currentAnnualSalary: 90_000, incomeReplacementRatio: 95 }));
    expect(advice.lean).toBe("SPLIT");
    expect(advice.leanReason).toMatch(/hedge/i);
  });

  it("nudges a young saver off a middling traditional lean toward a split", () => {
    const advice = buildAccountAdvice(base({ age: 26, currentAnnualSalary: 120_000, incomeReplacementRatio: 40 }));
    expect(advice.lean).toBe("SPLIT");
    expect(advice.leanReason).toMatch(/26/);
  });

  it("routes the IRA step to traditional once Roth is phased out", () => {
    const advice = buildAccountAdvice(base({ currentAnnualSalary: 200_000, age: 45 }));
    expect(advice.rothIraPhasedOut).toBe(true);
    const ira = advice.steps.find((s) => s.key === "ira")!;
    expect(ira.lean).toBe("TRADITIONAL");
    expect(ira.detail).toMatch(/phased out/i);
  });

  it("flags a partial phase-out without forcing traditional", () => {
    const advice = buildAccountAdvice(base({ currentAnnualSalary: 160_000, age: 45 }));
    expect(advice.rothIraPhasedOut).toBe(false);
    expect(advice.steps.find((s) => s.key === "ira")!.detail).toMatch(/phase-out range/i);
  });

  it("reports 401k headroom against the plain limit", () => {
    const advice = buildAccountAdvice(base({ annualContribution: 10_000 }));
    const fill = advice.steps.find((s) => s.key === "401k-fill")!;
    expect(fill.amount).toBe(14_500); // 24,500 - 10,000 for 2026
    expect(fill.detail).toContain("24,500");
  });

  it("uses the catch-up limit and calls it out past 50", () => {
    const advice = buildAccountAdvice(base({ age: 55, annualContribution: 10_000 }));
    expect(advice.steps.find((s) => s.key === "401k-fill")!.amount).toBe(22_500); // 32,500 - 10,000
    expect(advice.steps.some((s) => s.key === "catch-up")).toBe(true);
    expect(advice.steps.find((s) => s.key === "ira")!.amount).toBe(8_600);
  });

  it("says so when the deferral is already maxed", () => {
    const advice = buildAccountAdvice(base({ annualContribution: 24_500 }));
    expect(advice.steps.some((s) => s.key === "401k-fill")).toBe(false);
    expect(advice.steps.find((s) => s.key === "401k-maxed")!.detail).toMatch(/brokerage/i);
  });

  it("recommends an IRA when there's no workplace plan", () => {
    const advice = buildAccountAdvice(base({ hasWorkplacePlan: false, hasIra: false }));
    expect(advice.steps.some((s) => s.key === "ira")).toBe(true);
    expect(advice.steps.some((s) => s.key.startsWith("401k"))).toBe(false);
  });

  it("skips the IRA step for someone with only a workplace plan on file", () => {
    const advice = buildAccountAdvice(base({ hasIra: false }));
    expect(advice.steps.some((s) => s.key === "ira")).toBe(false);
  });

  it("holds off on a verdict when salary is unknown", () => {
    const advice = buildAccountAdvice(base({ currentAnnualSalary: 0, annualContribution: 0 }));
    expect(advice.lean).toBe("SPLIT");
    expect(advice.leanReason).toMatch(/salary/i);
  });

  it("marks a tax year outside the tables as a fallback", () => {
    expect(buildAccountAdvice(base({ taxYear: 2099 })).isFallbackYear).toBe(true);
    expect(buildAccountAdvice(base({ taxYear: 2026 })).isFallbackYear).toBe(false);
  });
});
