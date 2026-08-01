// Query-layer tests: these cover the assembly logic (which accounts count,
// how monthly contribution is normalised, what happens with no plan) by
// stubbing prisma and the snapshot history.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    retirementPlan: { findUnique: vi.fn() },
    financialAccount: { findMany: vi.fn() },
    contribution: { findMany: vi.fn() },
    contributionSchedule: { findMany: vi.fn() },
    employerMatch: { findFirst: vi.fn() },
    accountSnapshot: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/snapshots", () => ({ getNetWorthHistory: vi.fn() }));

import { getRetirementPageData } from "./retirement";
import { prisma } from "@/lib/prisma";

const plan = vi.mocked(prisma.retirementPlan);
const account = vi.mocked(prisma.financialAccount);
const contribution = vi.mocked(prisma.contribution);
const schedule = vi.mocked(prisma.contributionSchedule);
const match = vi.mocked(prisma.employerMatch);
const snapshot = vi.mocked(prisma.accountSnapshot);

const TODAY = "2026-01-01";

const planRow = {
  id: "p1",
  userId: "u1",
  birthYear: 1990,
  targetRetirementAge: 65,
  expectedReturn: "7",
  inflationRate: "3",
  incomeReplacementRatio: "80",
  safeWithdrawalRate: "4",
  expectedSocialSecurityMonthly: "0",
  currentAnnualSalary: "100000",
  completedAt: new Date("2026-01-01T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  plan.findUnique.mockResolvedValue(null);
  account.findMany.mockResolvedValue([]);
  contribution.findMany.mockResolvedValue([]);
  schedule.findMany.mockResolvedValue([]);
  match.findFirst.mockResolvedValue(null);
  snapshot.findMany.mockResolvedValue([]);
});

describe("getRetirementPageData", () => {
  it("reports no plan when the wizard has not been completed", async () => {
    const data = await getRetirementPageData("u1", TODAY);
    expect(data.hasPlan).toBe(false);
    expect(data.projection).toBeNull();
  });

  it("treats an incomplete plan row as no plan", async () => {
    plan.findUnique.mockResolvedValue({ ...planRow, completedAt: null } as never);
    const data = await getRetirementPageData("u1", TODAY);
    expect(data.hasPlan).toBe(false);
  });

  it("reports no accounts when the user has none of the right type", async () => {
    const data = await getRetirementPageData("u1", TODAY);
    expect(data.hasAccounts).toBe(false);
  });

  it("sums balances across retirement and investment accounts", async () => {
    plan.findUnique.mockResolvedValue(planRow as never);
    account.findMany.mockResolvedValue([
      { id: "a1", name: "401k", type: "RETIREMENT", currentBalance: "100000", color: "#000" },
      { id: "a2", name: "Brokerage", type: "INVESTMENT", currentBalance: "50000", color: "#111" },
    ] as never);
    const data = await getRetirementPageData("u1", TODAY);
    expect(data.totalBalance).toBe(150_000);
    expect(data.hasAccounts).toBe(true);
  });

  it("produces a projection and target once a plan exists", async () => {
    plan.findUnique.mockResolvedValue(planRow as never);
    account.findMany.mockResolvedValue([
      { id: "a1", name: "401k", type: "RETIREMENT", currentBalance: "100000", color: "#000" },
    ] as never);
    const data = await getRetirementPageData("u1", TODAY);
    expect(data.projection).not.toBeNull();
    expect(data.target).not.toBeNull();
    expect(data.target!.target).toBe(2_000_000);
  });

  it("normalises schedule amounts to a monthly contribution figure", async () => {
    plan.findUnique.mockResolvedValue(planRow as never);
    account.findMany.mockResolvedValue([
      { id: "a1", name: "401k", type: "RETIREMENT", currentBalance: "0", color: "#000" },
    ] as never);
    schedule.findMany.mockResolvedValue([
      {
        id: "s1",
        financialAccountId: "a1",
        amount: "500",
        source: "EMPLOYEE_PRETAX",
        frequency: "BIWEEKLY",
        interval: 1,
        startDate: new Date("2020-01-01T00:00:00.000Z"),
        endDate: null,
        dayOfMonth: null,
        weekday: 5,
      },
    ] as never);
    const data = await getRetirementPageData("u1", TODAY);
    // $500 biweekly is 26 payments a year: 500 * 26 / 12 = 1083.333..., rounded to cents.
    expect(data.currentMonthlyContribution).toBe(1_083.33);
  });

  it("computes a Coast FIRE projection alongside the contributing one", async () => {
    plan.findUnique.mockResolvedValue(planRow as never);
    account.findMany.mockResolvedValue([
      { id: "a1", name: "401k", type: "RETIREMENT", currentBalance: "100000", color: "#000" },
    ] as never);
    schedule.findMany.mockResolvedValue([
      {
        id: "s1",
        financialAccountId: "a1",
        amount: "1000",
        source: "EMPLOYEE_PRETAX",
        frequency: "MONTHLY",
        interval: 1,
        startDate: new Date("2020-01-01T00:00:00.000Z"),
        endDate: null,
        dayOfMonth: 1,
        weekday: null,
      },
    ] as never);
    const data = await getRetirementPageData("u1", TODAY);
    expect(data.coastProjection!.finalBalance).toBeLessThan(data.projection!.finalBalance);
    expect(data.coastProjection!.totalContributed).toBe(0);
  });

  it("attributes growth against a start balance covering only retirement accounts", async () => {
    plan.findUnique.mockResolvedValue(planRow as never);
    account.findMany.mockResolvedValue([
      { id: "a1", name: "401k", type: "RETIREMENT", currentBalance: "100000", color: "#000" },
      { id: "a2", name: "Brokerage", type: "INVESTMENT", currentBalance: "20000", color: "#111" },
    ] as never);
    // Newest-first, as the query orders them: the later row for a1 is ignored.
    snapshot.findMany.mockResolvedValue([
      { accountId: "a1", balance: "90000" },
      { accountId: "a2", balance: "18000" },
      { accountId: "a1", balance: "70000" },
    ] as never);

    const data = await getRetirementPageData("u1", TODAY);

    // A whole-portfolio start balance would have dragged non-retirement assets
    // into the subtraction; 120000 - 108000 is the retirement-only delta.
    expect(data.growth!.marketReturn).toBe(12_000);
    const where = snapshot.findMany.mock.calls[0][0]!.where as {
      accountId: { in: string[] };
    };
    expect(where.accountId.in).toEqual(["a1", "a2"]);
  });

  it("earns an employer match on elective deferrals and compounds it", async () => {
    plan.findUnique.mockResolvedValue(planRow as never);
    account.findMany.mockResolvedValue([
      { id: "a1", name: "401k", type: "RETIREMENT", currentBalance: "0", color: "#000" },
    ] as never);
    schedule.findMany.mockResolvedValue([
      {
        id: "s1",
        financialAccountId: "a1",
        amount: "1000",
        source: "EMPLOYEE_PRETAX",
        frequency: "MONTHLY",
        interval: 1,
        startDate: new Date("2020-01-01T00:00:00.000Z"),
        endDate: null,
        dayOfMonth: 1,
        weekday: null,
      },
    ] as never);
    match.findFirst.mockResolvedValue({
      id: "m1",
      userId: "u1",
      financialAccountId: "a1",
      tiers: [{ matchPercent: 100, upToPercentOfSalary: 3 }],
      annualCap: null,
    } as never);

    const data = await getRetirementPageData("u1", TODAY);

    // $12k/yr deferral clears the 3%-of-$100k tier, so the match is the full
    // $3000/yr: $250/month on top of the user's own $1000.
    expect(data.currentMonthlyContribution).toBe(1_000);
    expect(data.currentMonthlyEmployerMatch).toBe(250);
    expect(data.employerMatch).toEqual({
      financialAccountId: "a1",
      tiers: [{ matchPercent: 100, upToPercentOfSalary: 3 }],
      annualCap: null,
    });
    // Required-savings compares against the combined pace, not the user's alone.
    expect(data.requiredSavings!.currentMonthly).toBe(1_250);
    // The projection runs to age 65, contributing the combined $1250/month the
    // whole way rather than the user's $1000, so the match compounds too.
    expect(data.projection!.totalContributed).toBe(435_000);
  });

  it("does not match after-tax or rollover money", async () => {
    plan.findUnique.mockResolvedValue(planRow as never);
    account.findMany.mockResolvedValue([
      { id: "a1", name: "401k", type: "RETIREMENT", currentBalance: "0", color: "#000" },
    ] as never);
    schedule.findMany.mockResolvedValue([
      {
        id: "s1",
        financialAccountId: "a1",
        amount: "1000",
        source: "AFTER_TAX",
        frequency: "MONTHLY",
        interval: 1,
        startDate: new Date("2020-01-01T00:00:00.000Z"),
        endDate: null,
        dayOfMonth: 1,
        weekday: null,
      },
    ] as never);
    match.findFirst.mockResolvedValue({
      id: "m1",
      userId: "u1",
      financialAccountId: "a1",
      tiers: [{ matchPercent: 100, upToPercentOfSalary: 3 }],
      annualCap: null,
    } as never);

    const data = await getRetirementPageData("u1", TODAY);

    expect(data.currentMonthlyContribution).toBe(1_000);
    expect(data.currentMonthlyEmployerMatch).toBe(0);
  });

  it("reports no match when none is configured", async () => {
    plan.findUnique.mockResolvedValue(planRow as never);
    account.findMany.mockResolvedValue([
      { id: "a1", name: "401k", type: "RETIREMENT", currentBalance: "0", color: "#000" },
    ] as never);
    const data = await getRetirementPageData("u1", TODAY);
    expect(data.currentMonthlyEmployerMatch).toBe(0);
    expect(data.employerMatch).toBeNull();
  });

  it("skips growth attribution when no snapshot predates the lookback window", async () => {
    plan.findUnique.mockResolvedValue(planRow as never);
    account.findMany.mockResolvedValue([
      { id: "a1", name: "401k", type: "RETIREMENT", currentBalance: "100000", color: "#000" },
    ] as never);
    const data = await getRetirementPageData("u1", TODAY);
    expect(data.growth).toBeNull();
  });
});
