// Tests for the net-worth forecast: a straight-line cash-flow projection that
// walks active recurring rules forward and applies their signed effect to the
// current net, emitting one point per month boundary.
//
// Prisma is mocked; no real database is touched.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { recurringRule: { findMany: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import { forecastNetWorth } from "./networth-forecast";

const ruleFind = vi.mocked(prisma.recurringRule.findMany);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("forecastNetWorth", () => {
  it("returns empty when there are no active rules", async () => {
    ruleFind.mockResolvedValue([] as never);
    const res = await forecastNetWorth("u1", 1000, 3, "2026-06-14");
    expect(res).toEqual([]);
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
    expect(res).toEqual([]);
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
    expect(res).toEqual([
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
    expect(res).toEqual([
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
    expect(res).toEqual([{ date: "2026-07-14", net: 600 }]);
  });
});
