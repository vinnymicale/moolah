import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { TriggerContext } from "../types";
import { noSpendStreak } from "./no-spend-streak";

vi.mock("@/lib/prisma", () => ({
  prisma: { transaction: { findFirst: vi.fn() } },
}));

const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
  userId: "u1", params: { days: 3 }, todayISO: "2026-07-09",
  now: new Date("2026-07-09T12:00:00Z"), ...over,
});
beforeEach(() => vi.clearAllMocks());

describe("no-spend-streak", () => {
  it("fires when there is no spend in the window", async () => {
    // most recent expense was before the 3-day window (window starts 2026-07-06)
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);
    const events = await noSpendStreak.evaluate(ctx());
    expect(events).toEqual([
      { dedupeKey: "no-spend-streak:2026-07-06",
        vars: { days: "3", since: "2026-07-06" } },
    ]);
  });

  it("is silent when there was a recent expense", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({ id: "t1" } as never);
    expect(await noSpendStreak.evaluate(ctx())).toEqual([]);
  });
});
