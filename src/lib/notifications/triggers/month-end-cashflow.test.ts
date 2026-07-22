import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { TriggerContext } from "../types";
import { monthEndCashflow } from "./month-end-cashflow";

vi.mock("@/lib/prisma", () => ({
  prisma: { transaction: { aggregate: vi.fn() } },
}));

const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
  userId: "u1", params: {}, todayISO: "2026-07-31",
  now: new Date("2026-07-31T12:00:00Z"), ...over,
});
beforeEach(() => vi.clearAllMocks());

describe("month-end-cashflow", () => {
  it("fires on the last day with net cashflow", async () => {
    vi.mocked(prisma.transaction.aggregate)
      .mockResolvedValueOnce({ _sum: { amount: 5000 } } as never) // income
      .mockResolvedValueOnce({ _sum: { amount: 3200 } } as never); // expense
    const events = await monthEndCashflow.evaluate(ctx());
    expect(events).toEqual([
      { dedupeKey: "month-end-cashflow:2026-07",
        vars: { income: "$5,000.00", expenses: "$3,200.00", net: "$1,800.00", month: "2026-07" } },
    ]);
  });

  it("is silent when it is not the last day of the month", async () => {
    expect(await monthEndCashflow.evaluate(ctx({ todayISO: "2026-07-15" }))).toEqual([]);
  });
});
