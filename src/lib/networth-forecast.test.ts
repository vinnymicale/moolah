// Tests for the net-worth forecast: a cash-flow projection that walks active
// recurring rules forward and applies their signed effect to the current net,
// emitting one point per month boundary, with the slope calibrated against
// realized snapshot history.
//
// Prisma and the snapshot history are mocked; no real database is touched.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { recurringRule: { findMany: vi.fn() } },
}));
vi.mock("./snapshots", () => ({ getNetWorthHistory: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { getNetWorthHistory } from "./snapshots";
import {
  forecastNetWorth,
  realizedMonthlyRate,
  calibrationFactor,
} from "./networth-forecast";

const ruleFind = vi.mocked(prisma.recurringRule.findMany);
const historyFind = vi.mocked(getNetWorthHistory);

/** Snapshot history spanning `days` with a total net change of `change`. */
function historySpanning(days: number, startNet: number, change: number) {
  const start = Date.UTC(2026, 1, 1);
  return [
    { date: new Date(start).toISOString().slice(0, 10), assets: startNet, liabilities: 0, net: startNet },
    {
      date: new Date(start + days * 86_400_000).toISOString().slice(0, 10),
      assets: startNet + change,
      liabilities: 0,
      net: startNet + change,
    },
  ];
}

/** ISO day `offset` days after a fixed epoch, for building day-by-day series. */
function isoAfter(offset: number) {
  return new Date(Date.UTC(2026, 1, 1) + offset * 86_400_000).toISOString().slice(0, 10);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no usable history, so the rules projection passes through intact.
  historyFind.mockResolvedValue([]);
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

describe("realizedMonthlyRate", () => {
  it("returns null without at least two points", () => {
    expect(realizedMonthlyRate([])).toBeNull();
    expect(realizedMonthlyRate([{ date: "2026-06-01", net: 100 }])).toBeNull();
  });

  it("returns null when the history is shorter than the minimum span", () => {
    // 30 days is below the 45-day floor.
    expect(realizedMonthlyRate(historySpanning(30, 1000, 500))).toBeNull();
  });

  it("converts total change over the span into a monthly rate", () => {
    // +$900 across 91 days (~2.99 months) is close to $300/mo.
    const rate = realizedMonthlyRate(historySpanning(91, 10_000, 900));
    expect(rate).toBeCloseTo(301, 0);
  });

  it("reports a negative rate for a declining history", () => {
    const rate = realizedMonthlyRate(historySpanning(91, 10_000, -600));
    expect(rate).toBeCloseTo(-200.7, 1);
  });

  // getNetWorthHistory always returns one point per requested day, and days
  // before the user's first snapshot carry net = 0 because no balance has been
  // seen yet. Those leading zeros are absence of data, not a real $0 net worth,
  // and treating them as observations invents enormous growth.
  it("ignores the zero-filled run before the first real snapshot", () => {
    const history = [
      ...Array.from({ length: 110 }, (_, i) => ({ date: isoAfter(i), net: 0 })),
      ...Array.from({ length: 10 }, (_, i) => ({ date: isoAfter(110 + i), net: 50_000 })),
    ];
    // Only 10 days of genuine history: below the 45-day floor, so unmeasurable.
    expect(realizedMonthlyRate(history)).toBeNull();
  });

  it("measures from the first real snapshot when enough genuine history exists", () => {
    const history = [
      ...Array.from({ length: 30 }, (_, i) => ({ date: isoAfter(i), net: 0 })),
      ...Array.from({ length: 91 }, (_, i) => ({
        date: isoAfter(30 + i),
        net: 10_000 + (900 * i) / 90,
      })),
    ];
    // +$900 across the 90 days that actually have data (~2.96 months).
    expect(realizedMonthlyRate(history)).toBeCloseTo(304.4, 0);
  });

  it("still measures a history that legitimately passes through zero", () => {
    // A real line that starts negative and crosses zero must not be mistaken
    // for zero-fill: only the leading run before any data is skipped.
    const history = Array.from({ length: 91 }, (_, i) => ({
      date: isoAfter(i),
      net: -1000 + (2000 * i) / 90,
    }));
    expect(realizedMonthlyRate(history)).toBeCloseTo(676.4, 0);
  });
});

describe("calibrationFactor", () => {
  it("leaves the projection alone when there is no realized rate", () => {
    expect(calibrationFactor(500, null)).toBe(1);
  });

  it("leaves an already-pessimistic projection alone", () => {
    // Rules predict a loss; nothing to damp.
    expect(calibrationFactor(-200, 50)).toBe(1);
  });

  it("leaves the projection alone when reality outpaces the rules", () => {
    expect(calibrationFactor(300, 800)).toBe(1);
  });

  it("scales growth down to the realized rate", () => {
    // Rules say +$1000/mo, reality says +$250/mo.
    expect(calibrationFactor(1000, 250)).toBeCloseTo(0.25, 5);
  });

  it("flattens the projection when reality is flat or shrinking", () => {
    expect(calibrationFactor(1000, 0)).toBe(0);
    expect(calibrationFactor(1000, -400)).toBe(0);
  });
});

describe("forecastNetWorth calibration", () => {
  const incomeHeavyRules = [
    {
      frequency: "MONTHLY", interval: 1, startDate: "2026-01-01",
      endDate: null, dayOfMonth: 1, weekday: null,
      amount: 1000, type: "INCOME",
    },
  ];

  it("damps a rules projection that outruns realized history", async () => {
    ruleFind.mockResolvedValue(incomeHeavyRules as never);
    // Rules imply +$1000/mo, but net worth actually rose $750 over ~3 months
    // ($250/mo), so growth should be scaled to a quarter.
    historyFind.mockResolvedValue(historySpanning(91, 10_000, 750));

    const res = await forecastNetWorth("u1", 10_000, 3, "2026-06-14");

    expect(res.basis).toBe("calibrated");
    expect(res.rulesMonthly).toBeCloseTo(1000, 0);
    expect(res.realizedMonthly).toBeCloseTo(250.9, 1);
    // Each month adds ~$250 instead of $1000.
    expect(res.points[0].net).toBeCloseTo(10_250, -1);
    expect(res.points[2].net).toBeCloseTo(10_750, -1);
  });

  it("flattens the line when history has been flat", async () => {
    ruleFind.mockResolvedValue(incomeHeavyRules as never);
    historyFind.mockResolvedValue(historySpanning(91, 10_000, 0));

    const res = await forecastNetWorth("u1", 10_000, 3, "2026-06-14");

    expect(res.basis).toBe("calibrated");
    expect(res.points.map((p) => p.net)).toEqual([10_000, 10_000, 10_000]);
  });

  it("passes the rules through when history is too short to calibrate", async () => {
    ruleFind.mockResolvedValue(incomeHeavyRules as never);
    historyFind.mockResolvedValue(historySpanning(20, 10_000, 0));

    const res = await forecastNetWorth("u1", 10_000, 3, "2026-06-14");

    expect(res.basis).toBe("rules");
    expect(res.realizedMonthly).toBeNull();
    expect(res.points.map((p) => p.net)).toEqual([11_000, 12_000, 13_000]);
  });

  it("does not inflate the projection when reality has outperformed", async () => {
    ruleFind.mockResolvedValue(incomeHeavyRules as never);
    // Realized +$2000/mo beats the rules' +$1000/mo; we stay conservative.
    historyFind.mockResolvedValue(historySpanning(91, 10_000, 6000));

    const res = await forecastNetWorth("u1", 10_000, 3, "2026-06-14");

    expect(res.basis).toBe("rules");
    expect(res.points.map((p) => p.net)).toEqual([11_000, 12_000, 13_000]);
  });
});
