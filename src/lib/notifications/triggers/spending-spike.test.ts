import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { TriggerContext } from "../types";
import { spendingSpike } from "./spending-spike";

vi.mock("@/lib/prisma", () => ({
  prisma: { transaction: { aggregate: vi.fn() } },
}));

const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
  userId: "u1", params: { percent: 50 }, todayISO: "2026-07-09",
  now: new Date("2026-07-09T12:00:00Z"), ...over,
});
beforeEach(() => vi.clearAllMocks());

describe("spending-spike", () => {
  it("fires when this week beats the 4-week average by the percent", async () => {
    // first call = this week (7d), second = prior 28d
    vi.mocked(prisma.transaction.aggregate)
      .mockResolvedValueOnce({ _sum: { amount: 300 } } as never)
      .mockResolvedValueOnce({ _sum: { amount: 400 } } as never); // avg/week = 100
    const events = await spendingSpike.evaluate(ctx());
    expect(events).toEqual([
      { dedupeKey: "spending-spike:2026-07-09",
        vars: { this_week: "$300.00", average: "$100.00", percent: "200" } },
    ]);
  });

  it("is silent when under the threshold", async () => {
    vi.mocked(prisma.transaction.aggregate)
      .mockResolvedValueOnce({ _sum: { amount: 110 } } as never)
      .mockResolvedValueOnce({ _sum: { amount: 400 } } as never); // avg = 100, +10% only
    expect(await spendingSpike.evaluate(ctx())).toEqual([]);
  });

  it("is silent with no prior history", async () => {
    vi.mocked(prisma.transaction.aggregate)
      .mockResolvedValueOnce({ _sum: { amount: 300 } } as never)
      .mockResolvedValueOnce({ _sum: { amount: null } } as never);
    expect(await spendingSpike.evaluate(ctx())).toEqual([]);
  });
});
