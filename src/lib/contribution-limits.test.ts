import { describe, expect, it } from "vitest";
import { computeContributionLimits, computeMatch } from "./contribution-limits";
import type { ContributionRecord, YtdContributionRecord } from "./retirement-types";

const tiers = [
  { matchPercent: 100, upToPercentOfSalary: 3 },
  { matchPercent: 50, upToPercentOfSalary: 2 },
];

const contrib = (over: Partial<ContributionRecord> = {}): ContributionRecord => ({
  financialAccountId: "a1",
  date: new Date("2026-03-01T00:00:00.000Z"),
  amount: 1_000,
  source: "EMPLOYEE_PRETAX",
  ...over,
});

describe("computeMatch", () => {
  it("pays the full match when deferral covers every tier", () => {
    // 100% of 3% ($3,000) + 50% of 2% ($1,000) = $4,000 on a $100k salary.
    const r = computeMatch({ annualSalary: 100_000, annualDeferral: 20_000, tiers, annualCap: null });
    expect(r.maxAnnualMatch).toBe(4_000);
    expect(r.projectedMatch).toBe(4_000);
    expect(r.forfeited).toBe(0);
    expect(r.capturedPercent).toBe(100);
  });

  it("pays a partial match when deferral stops inside the first tier", () => {
    // Deferring 2% of salary earns 100% of that 2% = $2,000.
    const r = computeMatch({ annualSalary: 100_000, annualDeferral: 2_000, tiers, annualCap: null });
    expect(r.projectedMatch).toBe(2_000);
    expect(r.forfeited).toBe(2_000);
  });

  it("pays a partial match when deferral stops inside the second tier", () => {
    // 3% earns $3,000; the next 1% earns 50% of $1,000 = $500.
    const r = computeMatch({ annualSalary: 100_000, annualDeferral: 4_000, tiers, annualCap: null });
    expect(r.projectedMatch).toBe(3_500);
    expect(r.forfeited).toBe(500);
  });

  it("pays nothing when there is no deferral", () => {
    const r = computeMatch({ annualSalary: 100_000, annualDeferral: 0, tiers, annualCap: null });
    expect(r.projectedMatch).toBe(0);
    expect(r.forfeited).toBe(4_000);
    expect(r.capturedPercent).toBe(0);
  });

  it("respects an annual cap below the tiered maximum", () => {
    const r = computeMatch({ annualSalary: 100_000, annualDeferral: 20_000, tiers, annualCap: 2_500 });
    expect(r.maxAnnualMatch).toBe(2_500);
    expect(r.projectedMatch).toBe(2_500);
  });

  it("returns zeroes when salary is unset", () => {
    const r = computeMatch({ annualSalary: 0, annualDeferral: 5_000, tiers, annualCap: null });
    expect(r.maxAnnualMatch).toBe(0);
    expect(r.projectedMatch).toBe(0);
  });

  it("returns zeroes when there are no tiers", () => {
    const r = computeMatch({ annualSalary: 100_000, annualDeferral: 5_000, tiers: [], annualCap: null });
    expect(r.maxAnnualMatch).toBe(0);
    expect(r.projectedMatch).toBe(0);
    expect(r.forfeited).toBe(0);
    expect(r.capturedPercent).toBe(0);
  });
});

describe("computeContributionLimits", () => {
  const opts = {
    year: 2026,
    age: 35,
    iraAccountIds: [] as string[],
    annualSalary: 100_000,
    matchTiers: null,
    matchAnnualCap: null,
  };

  it("combines pre-tax and Roth deferrals against one limit", () => {
    const r = computeContributionLimits({
      ...opts,
      contributions: [
        contrib({ amount: 5_000, source: "EMPLOYEE_PRETAX" }),
        contrib({ amount: 3_000, source: "EMPLOYEE_ROTH" }),
      ],
    });
    expect(r.electiveDeferral.used).toBe(8_000);
  });

  it("excludes employer match from the elective deferral limit", () => {
    const r = computeContributionLimits({
      ...opts,
      contributions: [
        contrib({ amount: 5_000, source: "EMPLOYEE_PRETAX" }),
        contrib({ amount: 4_000, source: "EMPLOYER_MATCH" }),
      ],
    });
    expect(r.electiveDeferral.used).toBe(5_000);
  });

  it("counts employer match toward total additions", () => {
    const r = computeContributionLimits({
      ...opts,
      contributions: [
        contrib({ amount: 5_000, source: "EMPLOYEE_PRETAX" }),
        contrib({ amount: 4_000, source: "EMPLOYER_MATCH" }),
      ],
    });
    expect(r.totalAdditions.used).toBe(9_000);
  });

  it("excludes rollovers from every limit", () => {
    const r = computeContributionLimits({
      ...opts,
      contributions: [contrib({ amount: 50_000, source: "ROLLOVER" })],
    });
    expect(r.electiveDeferral.used).toBe(0);
    expect(r.totalAdditions.used).toBe(0);
  });

  it("counts only IRA-account contributions toward the IRA limit", () => {
    const r = computeContributionLimits({
      ...opts,
      iraAccountIds: ["ira1"],
      contributions: [
        contrib({ amount: 3_000, financialAccountId: "ira1", source: "EMPLOYEE_ROTH" }),
        contrib({ amount: 5_000, financialAccountId: "a1", source: "EMPLOYEE_PRETAX" }),
      ],
    });
    expect(r.ira.used).toBe(3_000);
  });

  it("ignores contributions from other years", () => {
    const r = computeContributionLimits({
      ...opts,
      contributions: [
        contrib({ amount: 5_000, date: new Date("2025-06-01T00:00:00.000Z") }),
        contrib({ amount: 2_000, date: new Date("2026-06-01T00:00:00.000Z") }),
      ],
    });
    expect(r.electiveDeferral.used).toBe(2_000);
  });

  it("raises the limit and flags eligibility at the catch-up age", () => {
    const under = computeContributionLimits({ ...opts, age: 49, contributions: [] });
    const over = computeContributionLimits({ ...opts, age: 50, contributions: [] });
    expect(under.catchUpEligible).toBe(false);
    expect(over.catchUpEligible).toBe(true);
    expect(over.electiveDeferral.limit).toBeGreaterThan(under.electiveDeferral.limit);
  });

  it("never reports negative remaining headroom", () => {
    const r = computeContributionLimits({
      ...opts,
      contributions: [contrib({ amount: 999_999, source: "EMPLOYEE_PRETAX" })],
    });
    expect(r.electiveDeferral.remaining).toBe(0);
    expect(r.electiveDeferral.percentUsed).toBe(100);
  });

  it("includes a match result only when tiers are configured", () => {
    const without = computeContributionLimits({ ...opts, contributions: [] });
    expect(without.match).toBeNull();

    const with_ = computeContributionLimits({ ...opts, matchTiers: tiers, contributions: [] });
    expect(with_.match).not.toBeNull();
    expect(with_.match!.maxAnnualMatch).toBe(4_000);
  });

  it("reports no override when there are no YTD totals", () => {
    const r = computeContributionLimits({ ...opts, contributions: [contrib()] });
    expect(r.usesYtdOverride).toBe(false);
  });
});

describe("computeContributionLimits with hand-entered YTD totals", () => {
  const opts = {
    year: 2026,
    age: 35,
    iraAccountIds: [] as string[],
    annualSalary: 100_000,
    matchTiers: null,
    matchAnnualCap: null,
  };

  const ytd = (over: Partial<YtdContributionRecord> = {}): YtdContributionRecord => ({
    financialAccountId: "a1",
    amount: 1_000,
    source: "EMPLOYEE_PRETAX",
    ...over,
  });

  it("replaces logged contributions rather than adding to them", () => {
    const r = computeContributionLimits({
      ...opts,
      contributions: [contrib({ amount: 5_000, source: "EMPLOYEE_PRETAX" })],
      ytdContributions: [ytd({ amount: 12_000, source: "EMPLOYEE_PRETAX" })],
    });
    expect(r.electiveDeferral.used).toBe(12_000);
    expect(r.usesYtdOverride).toBe(true);
  });

  it("combines pre-tax and Roth totals against one limit", () => {
    const r = computeContributionLimits({
      ...opts,
      contributions: [],
      ytdContributions: [
        ytd({ amount: 9_000, source: "EMPLOYEE_PRETAX" }),
        ytd({ amount: 4_000, source: "EMPLOYEE_ROTH" }),
      ],
    });
    expect(r.electiveDeferral.used).toBe(13_000);
  });

  it("excludes employer match from deferrals but counts it in total additions", () => {
    const r = computeContributionLimits({
      ...opts,
      contributions: [],
      ytdContributions: [
        ytd({ amount: 9_000, source: "EMPLOYEE_PRETAX" }),
        ytd({ amount: 4_000, source: "EMPLOYER_MATCH" }),
      ],
    });
    expect(r.electiveDeferral.used).toBe(9_000);
    expect(r.totalAdditions.used).toBe(13_000);
  });

  it("excludes rollover totals from every limit", () => {
    const r = computeContributionLimits({
      ...opts,
      contributions: [],
      ytdContributions: [ytd({ amount: 50_000, source: "ROLLOVER" })],
    });
    expect(r.electiveDeferral.used).toBe(0);
    expect(r.totalAdditions.used).toBe(0);
  });

  it("counts only IRA-account totals toward the IRA limit", () => {
    const r = computeContributionLimits({
      ...opts,
      iraAccountIds: ["ira1"],
      contributions: [],
      ytdContributions: [
        ytd({ amount: 4_000, financialAccountId: "ira1", source: "EMPLOYEE_ROTH" }),
        ytd({ amount: 9_000, financialAccountId: "a1", source: "EMPLOYEE_PRETAX" }),
      ],
    });
    expect(r.ira.used).toBe(4_000);
  });

  it("drives the employer match calculation off the override", () => {
    const r = computeContributionLimits({
      ...opts,
      matchTiers: tiers,
      contributions: [contrib({ amount: 500, source: "EMPLOYEE_PRETAX" })],
      ytdContributions: [ytd({ amount: 20_000, source: "EMPLOYEE_PRETAX" })],
    });
    expect(r.match!.projectedMatch).toBe(4_000);
    expect(r.match!.forfeited).toBe(0);
  });
});
