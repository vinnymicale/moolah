import { describe, expect, it } from "vitest";
import { projectRetirement } from "./retirement-projection";
import type { RetirementAssumptions, ScheduledContribution } from "./retirement-types";

const TODAY = "2026-01-01";

const assumptions = (over: Partial<RetirementAssumptions> = {}): RetirementAssumptions => ({
  birthYear: 1996, // turns 30 in 2026, so 35 years to age 65
  targetRetirementAge: 65,
  expectedReturn: 7,
  inflationRate: 3,
  incomeReplacementRatio: 80,
  safeWithdrawalRate: 4,
  expectedSocialSecurityMonthly: 0,
  currentAnnualSalary: 100_000,
  ...over,
});

const monthly = (over: Partial<ScheduledContribution> = {}): ScheduledContribution => ({
  financialAccountId: "a1",
  amount: 1_000,
  source: "EMPLOYEE_PRETAX",
  frequency: "MONTHLY",
  interval: 1,
  startDate: new Date("2020-01-01T00:00:00.000Z"),
  endDate: null,
  dayOfMonth: 1,
  weekday: null,
  ...over,
});

describe("projectRetirement", () => {
  it("grows a starting balance with no contributions", () => {
    const r = projectRetirement({
      assumptions: assumptions(),
      startingBalance: 100_000,
      schedules: [],
      todayISO: TODAY,
    });
    expect(r.finalBalance).toBeGreaterThan(100_000);
    expect(r.totalContributed).toBe(0);
  });

  it("returns real (inflation-adjusted) growth below nominal growth", () => {
    const real = projectRetirement({
      assumptions: assumptions({ inflationRate: 3 }),
      startingBalance: 100_000,
      schedules: [],
      todayISO: TODAY,
    });
    const noInflation = projectRetirement({
      assumptions: assumptions({ inflationRate: 0 }),
      startingBalance: 100_000,
      schedules: [],
      todayISO: TODAY,
    });
    expect(real.finalBalance).toBeLessThan(noInflation.finalBalance);
  });

  it("projects to the target retirement age", () => {
    const r = projectRetirement({
      assumptions: assumptions(),
      startingBalance: 0,
      schedules: [],
      todayISO: TODAY,
    });
    // Age 30 in 2026 to age 65 is 35 years = 420 months.
    expect(r.monthsToRetirement).toBe(420);
    expect(r.points).toHaveLength(420);
  });

  it("adds scheduled contributions to the balance", () => {
    const without = projectRetirement({
      assumptions: assumptions(),
      startingBalance: 10_000,
      schedules: [],
      todayISO: TODAY,
    });
    const with_ = projectRetirement({
      assumptions: assumptions(),
      startingBalance: 10_000,
      schedules: [monthly()],
      todayISO: TODAY,
    });
    expect(with_.finalBalance).toBeGreaterThan(without.finalBalance);
    expect(with_.totalContributed).toBeGreaterThan(0);
  });

  it("counts exactly one contribution per month over the full horizon", () => {
    // monthly() anchors on the 1st, starting long before today (2020-01-01),
    // with no end date. TODAY is 2026-01-01, and 420 months out lands the
    // horizon on 2061-01-01 (see "projects to the target retirement age").
    // The projection window is the day after today through the horizon, so
    // occurrences run 2026-02-01, 2026-03-01, ..., 2061-01-01 inclusive: that
    // is (2061-2026)*12 + (1-2) + 1 = 420 occurrences of $1,000 each.
    const r = projectRetirement({
      assumptions: assumptions(),
      startingBalance: 0,
      schedules: [monthly()],
      todayISO: TODAY,
    });
    expect(r.totalContributed).toBe(420 * 1_000);
  });

  it("does not count a contribution that lands on todayISO itself", () => {
    // A schedule anchored to land exactly on TODAY (2026-01-01) is already
    // reflected in the starting balance, so it must not also be added as a
    // contribution. The first counted occurrence should be the next month,
    // 2026-02-01.
    const onToday = monthly({ startDate: new Date("2026-01-01T00:00:00.000Z") });
    const r = projectRetirement({
      assumptions: assumptions(),
      startingBalance: 0,
      schedules: [onToday],
      todayISO: TODAY,
    });
    expect(r.points[0].date).toBe("2026-02-01");
    expect(r.points[0].contributed).toBe(1_000);
    // Same 420-occurrence count as the always-monthly case above: today's
    // own occurrence is excluded, but every month from Feb 2026 through the
    // Jan 2061 horizon still gets one.
    expect(r.totalContributed).toBe(420 * 1_000);
  });

  it("splits the final balance into contributed capital and growth", () => {
    const r = projectRetirement({
      assumptions: assumptions(),
      startingBalance: 10_000,
      schedules: [monthly()],
      todayISO: TODAY,
    });
    expect(r.totalGrowth).toBeCloseTo(r.finalBalance - r.totalContributed - 10_000, 2);
  });

  it("ignores contributions when includeContributions is false (Coast FIRE)", () => {
    const coast = projectRetirement({
      assumptions: assumptions(),
      startingBalance: 100_000,
      schedules: [monthly()],
      todayISO: TODAY,
      includeContributions: false,
    });
    const none = projectRetirement({
      assumptions: assumptions(),
      startingBalance: 100_000,
      schedules: [],
      todayISO: TODAY,
    });
    expect(coast.finalBalance).toBeCloseTo(none.finalBalance, 2);
    expect(coast.totalContributed).toBe(0);
  });

  it("returns an empty projection when already at or past retirement age", () => {
    const r = projectRetirement({
      assumptions: assumptions({ birthYear: 1950 }),
      startingBalance: 100_000,
      schedules: [],
      todayISO: TODAY,
    });
    expect(r.monthsToRetirement).toBe(0);
    expect(r.points).toEqual([]);
    expect(r.finalBalance).toBe(100_000);
  });

  it("stops contributions after a schedule's end date", () => {
    const ending = monthly({ endDate: new Date("2027-01-01T00:00:00.000Z") });
    const r = projectRetirement({
      assumptions: assumptions(),
      startingBalance: 0,
      schedules: [ending],
      todayISO: TODAY,
    });
    // Window runs from the day after TODAY (2026-01-02) through the rule's
    // end date (2027-01-01) inclusive. Monthly on the 1st gives 2026-02-01,
    // 2026-03-01, ..., 2027-01-01: (2027-2026)*12 + (1-2) + 1 = 12
    // occurrences of $1,000 each, not 420.
    expect(r.totalContributed).toBe(12 * 1_000);
  });
});
