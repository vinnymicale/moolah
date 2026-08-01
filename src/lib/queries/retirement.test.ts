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
});
