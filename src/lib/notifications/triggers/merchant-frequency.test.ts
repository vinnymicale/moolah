import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { TriggerContext } from "../types";
import { merchantFrequency } from "./merchant-frequency";

vi.mock("@/lib/prisma", () => ({
  prisma: { transaction: { groupBy: vi.fn() } },
}));

const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
  userId: "u1", params: { count: 4 }, todayISO: "2026-07-09",
  now: new Date("2026-07-09T12:00:00Z"), ...over,
});
beforeEach(() => vi.clearAllMocks());

describe("merchant-frequency-spike", () => {
  it("fires for a merchant hit at or above the count", async () => {
    vi.mocked(prisma.transaction.groupBy).mockResolvedValue([
      { description: "Uber", _count: { _all: 5 }, _sum: { amount: 74.5 } },
      { description: "Target", _count: { _all: 2 }, _sum: { amount: 40 } },
    ] as never);
    const events = await merchantFrequency.evaluate(ctx());
    expect(events).toEqual([
      { dedupeKey: "merchant-frequency-spike:uber:2026-07-09",
        vars: { merchant: "Uber", count: "5", total: "$74.50" } },
    ]);
  });

  it("is silent when no merchant reaches the count", async () => {
    vi.mocked(prisma.transaction.groupBy).mockResolvedValue([
      { description: "Target", _count: { _all: 2 }, _sum: { amount: 40 } },
    ] as never);
    expect(await merchantFrequency.evaluate(ctx())).toEqual([]);
  });
});
