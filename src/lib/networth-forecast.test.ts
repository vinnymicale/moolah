// Tests for the net-worth forecast: a cash-flow projection that walks active
// recurring rules forward and applies their signed effect to the current net,
// emitting one point per month boundary, plus the everyday spending measured
// from transaction history that no rule accounts for.
//
// Prisma is mocked; no real database is touched.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recurringRule: { findMany: vi.fn() },
    transaction: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { forecastNetWorth } from "./networth-forecast";

const ruleFind = vi.mocked(prisma.recurringRule.findMany);
const txnFind = vi.mocked(prisma.transaction.findMany);

/**
 * A run of unmodelled EXPENSE transactions, one every `everyDays` days ending
 * the day before `todayISO`, each for `amount`.
 */
function spendingRun(todayISO: string, amount: number, everyDays: number, count: number) {
  const end = Date.parse(`${todayISO}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(end - (i + 1) * everyDays * 86_400_000),
    type: "EXPENSE",
    amount,
    recurringRuleId: null,
    isTransfer: false,
    account: { type: "CHECKING" },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no transactions, so the rules projection passes through intact.
  txnFind.mockResolvedValue([] as never);
});

describe("forecastNetWorth", () => {
  it("returns empty when there are no active rules", async () => {
    ruleFind.mockResolvedValue([] as never);
    const res = await forecastNetWorth("u1", 1000, 3, "2026-06-14");
    expect(res.points).toEqual([]);
  });

  it("returns empty when rules produce no occurrences in the horizon", async () => {
    // A rule that ended in the past yields nothing forward.
    ruleFind.mockResolvedValue([
      {
        frequency: "MONTHLY", interval: 1, startDate: "2020-01-01",
        endDate: "2020-12-31", dayOfMonth: 1, weekday: null,
        amount: 500, type: "INCOME",
      },
    ] as never);
    const res = await forecastNetWorth("u1", 1000, 3, "2026-06-14");
    expect(res.points).toEqual([]);
  });

  it("adds monthly recurring income to net at each month boundary", async () => {
    ruleFind.mockResolvedValue([
      {
        frequency: "MONTHLY", interval: 1, startDate: "2026-01-01",
        endDate: null, dayOfMonth: 1, weekday: null,
        amount: 100, type: "INCOME",
      },
    ] as never);

    const res = await forecastNetWorth("u1", 1000, 3, "2026-06-14");

    // Income lands on the 1st of each month: Jul 1, Aug 1, Sep 1.
    expect(res.points).toEqual([
      { date: "2026-07-14", net: 1100 },
      { date: "2026-08-14", net: 1200 },
      { date: "2026-09-14", net: 1300 },
    ]);
  });

  it("subtracts recurring expense from net", async () => {
    ruleFind.mockResolvedValue([
      {
        frequency: "MONTHLY", interval: 1, startDate: "2026-01-10",
        endDate: null, dayOfMonth: 10, weekday: null,
        amount: 200, type: "EXPENSE",
      },
    ] as never);

    const res = await forecastNetWorth("u1", 1000, 2, "2026-06-14");

    // Expense on the 10th: Jul 10 (in first month window), Aug 10.
    expect(res.points).toEqual([
      { date: "2026-07-14", net: 800 },
      { date: "2026-08-14", net: 600 },
    ]);
  });

  it("nets income against expense within the same period", async () => {
    ruleFind.mockResolvedValue([
      {
        frequency: "MONTHLY", interval: 1, startDate: "2026-01-01",
        endDate: null, dayOfMonth: 1, weekday: null,
        amount: 1000, type: "INCOME",
      },
      {
        frequency: "MONTHLY", interval: 1, startDate: "2026-01-15",
        endDate: null, dayOfMonth: 15, weekday: null,
        amount: 400, type: "EXPENSE",
      },
    ] as never);

    const res = await forecastNetWorth("u1", 0, 1, "2026-06-14");

    // First period (Jun 15 .. Jul 14): +1000 income on Jul 1, -400 expense on
    // Jun 15. The Jul 15 expense falls past the boundary, so net = 600.
    expect(res.points).toEqual([{ date: "2026-07-14", net: 600 }]);
  });
});


describe("forecastNetWorth unmodelled spending", () => {
  const paycheckRule = [
    {
      frequency: "MONTHLY", interval: 1, startDate: "2026-01-01",
      endDate: null, dayOfMonth: 1, weekday: null,
      amount: 1000, type: "INCOME",
    },
  ];

  it("projects rules alone when there are no transactions to measure", async () => {
    ruleFind.mockResolvedValue(paycheckRule as never);

    const res = await forecastNetWorth("u1", 10_000, 3, "2026-06-14");

    // The window is long enough to measure, and measures nothing: a real zero.
    expect(res.basis).toBe("cashflow");
    expect(res.unmodelledMonthly).toBe(0);
    expect(res.points.map((p) => p.net)).toEqual([11_000, 12_000, 13_000]);
  });

  it("drags the line down by the everyday spending no rule models", async () => {
    ruleFind.mockResolvedValue(paycheckRule as never);
    // $200 every 4 days across the 121-day window: 30 transactions, $6000,
    // which averages to about -$1509/mo - more than the paycheck brings in.
    txnFind.mockResolvedValue(spendingRun("2026-06-14", 200, 4, 30) as never);

    const res = await forecastNetWorth("u1", 10_000, 3, "2026-06-14");

    expect(res.basis).toBe("cashflow");
    expect(res.rulesMonthly).toBeCloseTo(1000, 0);
    expect(res.unmodelledMonthly).toBeCloseTo(-1509, -1);
    // Net worth now falls instead of climbing.
    expect(res.points[0].net).toBeLessThan(10_000);
    expect(res.points[2].net).toBeLessThan(res.points[0].net);
  });

  it("ignores spending a recurring rule already projects", async () => {
    ruleFind.mockResolvedValue(paycheckRule as never);
    const linked = spendingRun("2026-06-14", 200, 4, 30).map((t) => ({
      ...t,
      recurringRuleId: "rule-1",
    }));
    txnFind.mockResolvedValue(linked as never);

    const res = await forecastNetWorth("u1", 10_000, 3, "2026-06-14");

    // Double-counting it would drag the line down twice.
    expect(res.unmodelledMonthly).toBe(0);
    expect(res.points.map((p) => p.net)).toEqual([11_000, 12_000, 13_000]);
  });
});
