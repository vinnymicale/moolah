import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { TriggerContext } from "../types";
import { categoryFirstUse } from "./category-first-use";

vi.mock("@/lib/prisma", () => ({
  prisma: { transaction: { findMany: vi.fn(), count: vi.fn() } },
}));

const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
  userId: "u1", params: {}, todayISO: "2026-07-09",
  now: new Date("2026-07-09T12:00:00Z"), ...over,
});
const syncEvent = (ids: string[]) => ({ kind: "plaid-sync" as const, newTransactionIds: ids });
beforeEach(() => vi.clearAllMocks());

describe("category-first-use", () => {
  it("fires when the category has no other charge this month", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { id: "t1", description: "Delta", amount: 240, categoryId: "c1", category: { name: "Travel" } },
    ] as never);
    vi.mocked(prisma.transaction.count).mockResolvedValue(0);
    const events = await categoryFirstUse.evaluate(ctx({ event: syncEvent(["t1"]) }));
    expect(events).toEqual([
      { dedupeKey: "category-first-use:c1:2026-07",
        vars: { category: "Travel", merchant: "Delta", amount: "$240.00" } },
    ]);
  });

  it("is silent when the category was used earlier this month", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { id: "t1", description: "Delta", amount: 240, categoryId: "c1", category: { name: "Travel" } },
    ] as never);
    vi.mocked(prisma.transaction.count).mockResolvedValue(3);
    expect(await categoryFirstUse.evaluate(ctx({ event: syncEvent(["t1"]) }))).toEqual([]);
  });

  it("skips uncategorized transactions", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { id: "t1", description: "Cash", amount: 20, categoryId: null, category: null },
    ] as never);
    expect(await categoryFirstUse.evaluate(ctx({ event: syncEvent(["t1"]) }))).toEqual([]);
  });
});
