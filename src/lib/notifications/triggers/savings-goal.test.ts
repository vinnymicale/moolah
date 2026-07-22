import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { TriggerContext } from "../types";
import { savingsGoal } from "./savings-goal";

vi.mock("@/lib/prisma", () => ({
  prisma: { financialAccount: { findFirst: vi.fn() } },
}));

const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
  userId: "u1", params: { accountId: "a1", target: 10000 }, todayISO: "2026-07-09",
  now: new Date("2026-07-09T12:00:00Z"), ...over,
});
beforeEach(() => vi.clearAllMocks());

describe("savings-goal", () => {
  it("fires when the balance reaches the target", async () => {
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue(
      { id: "a1", name: "Savings", currentBalance: 10250 } as never);
    const events = await savingsGoal.evaluate(ctx());
    expect(events).toEqual([
      { dedupeKey: "savings-goal:a1:10000",
        vars: { account: "Savings", balance: "$10,250.00", target: "$10,000.00" } },
    ]);
  });

  it("is silent below the target", async () => {
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue(
      { id: "a1", name: "Savings", currentBalance: 9000 } as never);
    expect(await savingsGoal.evaluate(ctx())).toEqual([]);
  });

  it("is silent when the account is missing", async () => {
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue(null);
    expect(await savingsGoal.evaluate(ctx())).toEqual([]);
  });
});
