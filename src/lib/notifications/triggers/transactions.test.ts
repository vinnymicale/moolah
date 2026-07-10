import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { TriggerContext } from "../types";
import { largeTransaction } from "./large-transaction";
import { newMerchant } from "./new-merchant";
import { lowBalance } from "./low-balance";
import { ccUtilization } from "./cc-utilization";
import { incomeReceived } from "./income-received";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: vi.fn(), count: vi.fn() },
    financialAccount: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
  userId: "u1",
  params: {},
  todayISO: "2026-07-09",
  now: new Date("2026-07-09T12:00:00Z"),
  ...over,
});

const syncEvent = (ids: string[]) => ({ kind: "plaid-sync" as const, newTransactionIds: ids });

beforeEach(() => vi.clearAllMocks());

describe("large-transaction", () => {
  it("fires per new expense over the threshold", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { id: "t1", description: "Best Buy", amount: 899.99, account: { name: "Checking" }, category: { name: "Shopping" } },
    ] as never);
    const events = await largeTransaction.evaluate(ctx({ params: { amount: 500 }, event: syncEvent(["t1"]) }));
    expect(events).toEqual([
      {
        dedupeKey: "large-transaction:t1",
        vars: { merchant: "Best Buy", amount: "$899.99", account: "Checking", category: "Shopping" },
      },
    ]);
  });

  it("is silent without an event", async () => {
    expect(await largeTransaction.evaluate(ctx({ params: { amount: 500 } }))).toEqual([]);
  });
});

describe("new-merchant", () => {
  it("fires for a merchant with no prior transactions", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { id: "t1", description: "Blue Bottle", amount: 6.5, account: { name: "Checking" } },
    ] as never);
    vi.mocked(prisma.transaction.count).mockResolvedValue(0);
    const events = await newMerchant.evaluate(ctx({ event: syncEvent(["t1"]) }));
    expect(events).toEqual([
      {
        dedupeKey: "new-merchant:blue bottle",
        vars: { merchant: "Blue Bottle", amount: "$6.50", account: "Checking" },
      },
    ]);
  });

  it("is silent for a merchant seen before", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { id: "t1", description: "Blue Bottle", amount: 6.5, account: { name: "Checking" } },
    ] as never);
    vi.mocked(prisma.transaction.count).mockResolvedValue(2);
    expect(await newMerchant.evaluate(ctx({ event: syncEvent(["t1"]) }))).toEqual([]);
  });
});

describe("low-balance", () => {
  it("fires when the account balance is under the threshold", async () => {
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue(
      { id: "a1", name: "Checking", currentBalance: 87.2 } as never,
    );
    const events = await lowBalance.evaluate(ctx({ params: { amount: 100, accountId: "a1" } }));
    expect(events).toEqual([
      {
        dedupeKey: "low-balance:a1:2026-07-09",
        vars: { account: "Checking", balance: "$87.20", threshold: "$100.00" },
      },
    ]);
  });

  it("is silent at or above the threshold, or if the account is gone", async () => {
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue(
      { id: "a1", name: "Checking", currentBalance: 100 } as never,
    );
    expect(await lowBalance.evaluate(ctx({ params: { amount: 100, accountId: "a1" } }))).toEqual([]);
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue(null);
    expect(await lowBalance.evaluate(ctx({ params: { amount: 100, accountId: "a1" } }))).toEqual([]);
  });
});

describe("cc-utilization", () => {
  it("fires when utilization crosses the percent", async () => {
    vi.mocked(prisma.financialAccount.findMany).mockResolvedValue([
      { id: "a1", name: "Sapphire", currentBalance: 3200, creditLimit: 10000 },
    ] as never);
    const events = await ccUtilization.evaluate(ctx({ params: { percent: 30 } }));
    expect(events).toEqual([
      {
        dedupeKey: "cc-utilization:a1:2026-07-09",
        vars: { account: "Sapphire", percent: "32", balance: "$3,200.00", limit: "$10,000.00" },
      },
    ]);
  });

  it("is silent under the percent", async () => {
    vi.mocked(prisma.financialAccount.findMany).mockResolvedValue([
      { id: "a1", name: "Sapphire", currentBalance: 2000, creditLimit: 10000 },
    ] as never);
    expect(await ccUtilization.evaluate(ctx({ params: { percent: 30 } }))).toEqual([]);
  });
});

describe("income-received", () => {
  it("fires per new income transaction at or above the minimum", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { id: "t1", description: "Acme Payroll", amount: 2400, account: { name: "Checking" } },
    ] as never);
    const events = await incomeReceived.evaluate(ctx({ params: { minAmount: 100 }, event: syncEvent(["t1"]) }));
    expect(events).toEqual([
      {
        dedupeKey: "income-received:t1",
        vars: { merchant: "Acme Payroll", amount: "$2,400.00", account: "Checking" },
      },
    ]);
  });

  it("is silent without an event", async () => {
    expect(await incomeReceived.evaluate(ctx({ params: { minAmount: 100 } }))).toEqual([]);
  });
});
