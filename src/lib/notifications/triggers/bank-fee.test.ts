import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { TriggerContext } from "../types";
import { bankFee } from "./bank-fee";

vi.mock("@/lib/prisma", () => ({
  prisma: { transaction: { findMany: vi.fn() } },
}));

const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
  userId: "u1", params: { keywords: "atm fee,overdraft,interest" }, todayISO: "2026-07-09",
  now: new Date("2026-07-09T12:00:00Z"), ...over,
});
const syncEvent = (ids: string[]) => ({ kind: "plaid-sync" as const, newTransactionIds: ids });
beforeEach(() => vi.clearAllMocks());

describe("bank-fee", () => {
  it("fires when a description matches a keyword", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { id: "t1", description: "ATM Fee - Chase", amount: 3, account: { name: "Checking" } },
      { id: "t2", description: "Grocery Store", amount: 40, account: { name: "Checking" } },
    ] as never);
    const events = await bankFee.evaluate(ctx({ event: syncEvent(["t1", "t2"]) }));
    expect(events).toEqual([
      { dedupeKey: "bank-fee:t1",
        vars: { merchant: "ATM Fee - Chase", amount: "$3.00", account: "Checking", matched: "atm fee" } },
    ]);
  });

  it("is silent when nothing matches", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { id: "t2", description: "Grocery Store", amount: 40, account: { name: "Checking" } },
    ] as never);
    expect(await bankFee.evaluate(ctx({ event: syncEvent(["t2"]) }))).toEqual([]);
  });
});
