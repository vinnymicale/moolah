// Targeted tests for the two most logic-heavy read functions:
//   - getSafeToTransfer: the anchor − remaining expenses − early-month buffer
//     (×1.15) calculation, floored to $50, with its show/hide gating.
//   - getSpendingAnomalies: the ≥40%-over AND ≥$30-over detection that buckets
//     split parts in JS (split parents carry a null categoryId).
//
// Prisma is mocked per-call. Each test wires only the queries the function under
// test actually makes, in call order where the code relies on it.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    financialAccount: { findMany: vi.fn() },
    transaction: { findMany: vi.fn(), aggregate: vi.fn() },
    recurringRule: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { getSafeToTransfer, getSpendingAnomalies } from "./queries";

const acctFind = vi.mocked(prisma.financialAccount.findMany);
const txnFind = vi.mocked(prisma.transaction.findMany);
const txnAgg = vi.mocked(prisma.transaction.aggregate);
const ruleFind = vi.mocked(prisma.recurringRule.findMany);
const catFind = vi.mocked(prisma.category.findMany);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSafeToTransfer", () => {
  it("hides itself when the user has no checking account", async () => {
    acctFind.mockResolvedValue([
      { id: "s1", type: "SAVINGS", currentBalance: 5000, isAsset: true },
    ] as never);

    const res = await getSafeToTransfer("u1", "2026-06-15");
    expect(res.show).toBe(false);
    expect(res.safeAmount).toBe(0);
  });

  it("computes anchor − remaining − buffer×1.15, floored to $50", async () => {
    acctFind.mockResolvedValue([
      { id: "c1", type: "CHECKING", currentBalance: 3000, isAsset: true },
    ] as never);

    // Order matters: [uncleared one-offs, recurring rules, materialised links].
    txnFind
      .mockResolvedValueOnce([{ amount: 200 }] as never) // one-off uncleared expense
      .mockResolvedValueOnce([] as never); // materialised links (none)
    ruleFind.mockResolvedValue([] as never); // no recurring rules

    // Early-month buffer: 4 monthly aggregates. Two months of $400 → avg 400,
    // buffer = 400 × 1.15 = 460.
    txnAgg
      .mockResolvedValueOnce({ _sum: { amount: 400 } } as never)
      .mockResolvedValueOnce({ _sum: { amount: 400 } } as never)
      .mockResolvedValueOnce({ _sum: { amount: 0 } } as never)
      .mockResolvedValueOnce({ _sum: { amount: 0 } } as never);

    const res = await getSafeToTransfer("u1", "2026-06-15");

    // rawSafe = 3000 − 200 − 460 = 2340 → floor to $50 = 2300.
    expect(res.rawSafe).toBeCloseTo(2340);
    expect(res.safeAmount).toBe(2300);
    expect(res.show).toBe(true);
    expect(res.anchorBalance).toBe(3000);
    expect(res.remainingOneOff).toBe(200);
    expect(res.earlyMonthAvg).toBeCloseTo(400);
    expect(res.nextMonthBuffer).toBeCloseTo(460);
  });

  it("hides itself when the safe amount falls below $50", async () => {
    acctFind.mockResolvedValue([
      { id: "c1", type: "CHECKING", currentBalance: 100, isAsset: true },
    ] as never);
    txnFind
      .mockResolvedValueOnce([{ amount: 80 }] as never)
      .mockResolvedValueOnce([] as never);
    ruleFind.mockResolvedValue([] as never);
    txnAgg
      .mockResolvedValueOnce({ _sum: { amount: 0 } } as never)
      .mockResolvedValueOnce({ _sum: { amount: 0 } } as never)
      .mockResolvedValueOnce({ _sum: { amount: 0 } } as never)
      .mockResolvedValueOnce({ _sum: { amount: 0 } } as never);

    // rawSafe = 100 − 80 − 0 = 20 → floor $50 = 0 → below threshold.
    const res = await getSafeToTransfer("u1", "2026-06-15");
    expect(res.show).toBe(false);
  });

  it("excludes recurring occurrences already materialised by a real transaction", async () => {
    acctFind.mockResolvedValue([
      { id: "c1", type: "CHECKING", currentBalance: 5000, isAsset: true },
    ] as never);
    txnFind
      .mockResolvedValueOnce([] as never) // no one-off uncleared
      .mockResolvedValueOnce([
        { recurringRuleId: "r1", date: new Date("2026-06-20T00:00:00Z") },
      ] as never); // the rule's occurrence already exists as a txn
    ruleFind.mockResolvedValue([
      {
        id: "r1",
        type: "EXPENSE",
        amount: 1000,
        frequency: "MONTHLY",
        interval: 1,
        startDate: new Date("2026-01-20T00:00:00Z"),
        endDate: null,
        dayOfMonth: 20,
        weekday: null,
      },
    ] as never);
    txnAgg.mockResolvedValue({ _sum: { amount: 0 } } as never);

    const res = await getSafeToTransfer("u1", "2026-06-15");
    // The $1000 occurrence on the 20th is materialised, so it's not re-counted.
    expect(res.remainingRecurring).toBe(0);
    expect(res.remainingRecurringCount).toBe(0);
  });

  it("subtracts upcoming credit-card statement payments shown on the calendar", async () => {
    acctFind.mockResolvedValue([
      { id: "c1", type: "CHECKING", currentBalance: 3000, isAsset: true },
      // Due later this month with a $500 statement → counted.
      {
        id: "cc1", type: "CREDIT_CARD", currentBalance: -800, isAsset: false,
        lastStatementBalance: 500, nextPaymentDueDate: new Date("2026-06-25T00:00:00Z"), isOverdue: false,
      },
      // Due in the past and not overdue → assumed paid, not counted.
      {
        id: "cc2", type: "CREDIT_CARD", currentBalance: -300, isAsset: false,
        lastStatementBalance: 300, nextPaymentDueDate: new Date("2026-06-05T00:00:00Z"), isOverdue: false,
      },
      // Past but flagged overdue → still counted.
      {
        id: "cc3", type: "CREDIT_CARD", currentBalance: -150, isAsset: false,
        lastStatementBalance: 150, nextPaymentDueDate: new Date("2026-06-02T00:00:00Z"), isOverdue: true,
      },
    ] as never);

    txnFind
      .mockResolvedValueOnce([] as never) // no one-off uncleared
      .mockResolvedValueOnce([] as never); // no materialised links
    ruleFind.mockResolvedValue([] as never);
    txnAgg.mockResolvedValue({ _sum: { amount: 0 } } as never);

    const res = await getSafeToTransfer("u1", "2026-06-15");

    // cc1 ($500) + cc3 ($150, overdue) counted; cc2 (past, paid) skipped.
    expect(res.upcomingCCDue).toBe(650);
    expect(res.upcomingCCDueCount).toBe(2);
    // rawSafe = 3000 − 0 (remaining) − 650 (CC due) − 0 (buffer) = 2350 → floor 2350.
    expect(res.rawSafe).toBeCloseTo(2350);
    expect(res.safeAmount).toBe(2350);
  });

  it("ignores a credit card whose due date has no posted statement balance yet", async () => {
    acctFind.mockResolvedValue([
      { id: "c1", type: "CHECKING", currentBalance: 3000, isAsset: true },
      // Future due date but Plaid hasn't posted a statement balance.
      {
        id: "cc1", type: "CREDIT_CARD", currentBalance: -120, isAsset: false,
        lastStatementBalance: null, nextPaymentDueDate: new Date("2026-06-25T00:00:00Z"), isOverdue: false,
      },
    ] as never);
    txnFind
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    ruleFind.mockResolvedValue([] as never);
    txnAgg.mockResolvedValue({ _sum: { amount: 0 } } as never);

    const res = await getSafeToTransfer("u1", "2026-06-15");
    expect(res.upcomingCCDue).toBe(0);
    expect(res.upcomingCCDueCount).toBe(0);
    expect(res.rawSafe).toBeCloseTo(3000);
  });

  it("hides itself when an upcoming statement payment drives the safe amount below $50", async () => {
    acctFind.mockResolvedValue([
      { id: "c1", type: "CHECKING", currentBalance: 600, isAsset: true },
      {
        id: "cc1", type: "CREDIT_CARD", currentBalance: -580, isAsset: false,
        lastStatementBalance: 580, nextPaymentDueDate: new Date("2026-06-25T00:00:00Z"), isOverdue: false,
      },
    ] as never);
    txnFind
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    ruleFind.mockResolvedValue([] as never);
    txnAgg.mockResolvedValue({ _sum: { amount: 0 } } as never);

    // rawSafe = 600 − 0 − 580 − 0 = 20 → floor $50 = 0 → below threshold, so the
    // card hides and returns the zeroed "nothing" DTO.
    const res = await getSafeToTransfer("u1", "2026-06-15");
    expect(res.show).toBe(false);
    expect(res.safeAmount).toBe(0);
  });
});

describe("getSpendingAnomalies", () => {
  // Helper: an unsplit cleared expense row.
  const txn = (categoryId: string | null, amount: number) => ({ categoryId, amount, splits: [] });

  it("flags a category ≥40% and ≥$30 over its 3-month average", async () => {
    // current month: $200 on groceries
    txnFind.mockResolvedValueOnce([txn("groceries", 200)] as never);
    // three prior months: $100, $100, $100 → avg 100
    txnFind
      .mockResolvedValueOnce([txn("groceries", 100)] as never)
      .mockResolvedValueOnce([txn("groceries", 100)] as never)
      .mockResolvedValueOnce([txn("groceries", 100)] as never);
    catFind.mockResolvedValue([
      { id: "groceries", name: "Groceries", color: "#0a0", icon: "cart" },
    ] as never);

    const res = await getSpendingAnomalies("u1", "2026-06");
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      categoryId: "groceries",
      thisMonth: 200,
      avg3Month: 100,
      overBy: 100,
      overPct: 100,
    });
  });

  it("ignores a category with fewer than 2 months of real history", async () => {
    txnFind.mockResolvedValueOnce([txn("travel", 500)] as never);
    // Only one prior month had spend; two were zero.
    txnFind
      .mockResolvedValueOnce([txn("travel", 100)] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    catFind.mockResolvedValue([
      { id: "travel", name: "Travel", color: "#00a", icon: "plane" },
    ] as never);

    const res = await getSpendingAnomalies("u1", "2026-06");
    expect(res).toEqual([]);
  });

  it("ignores a category over by %≥40 but under $30 absolute", async () => {
    txnFind.mockResolvedValueOnce([txn("coffee", 28)] as never);
    txnFind
      .mockResolvedValueOnce([txn("coffee", 10)] as never)
      .mockResolvedValueOnce([txn("coffee", 10)] as never)
      .mockResolvedValueOnce([txn("coffee", 10)] as never);
    catFind.mockResolvedValue([
      { id: "coffee", name: "Coffee", color: "#852", icon: "cup" },
    ] as never);

    // avg = 10, thisMonth 28 → overPct 180% but overBy only $18 (< $30).
    const res = await getSpendingAnomalies("u1", "2026-06");
    expect(res).toEqual([]);
  });

  it("attributes split parts to their child categories, not the null parent", async () => {
    // A split parent: categoryId null, parts go to groceries + shopping.
    txnFind.mockResolvedValueOnce([
      {
        categoryId: null,
        amount: 300,
        splits: [
          { categoryId: "groceries", amount: 250 },
          { categoryId: "shopping", amount: 50 },
        ],
      },
    ] as never);
    // groceries history avg 100 (so $250 is anomalous); shopping history avg 60.
    txnFind
      .mockResolvedValueOnce([txn("groceries", 100), txn("shopping", 60)] as never)
      .mockResolvedValueOnce([txn("groceries", 100), txn("shopping", 60)] as never)
      .mockResolvedValueOnce([txn("groceries", 100), txn("shopping", 60)] as never);
    catFind.mockResolvedValue([
      { id: "groceries", name: "Groceries", color: "#0a0", icon: "cart" },
      { id: "shopping", name: "Shopping", color: "#a0a", icon: "bag" },
    ] as never);

    const res = await getSpendingAnomalies("u1", "2026-06");
    // Only groceries clears both thresholds ($250 vs avg 100). Shopping at $50
    // vs avg 60 is under, not over.
    expect(res.map((a) => a.categoryId)).toEqual(["groceries"]);
    expect(res[0].thisMonth).toBe(250);
  });

  it("returns [] when there is no spending this month", async () => {
    txnFind.mockResolvedValueOnce([] as never);
    const res = await getSpendingAnomalies("u1", "2026-06");
    expect(res).toEqual([]);
    // Short-circuits before querying history or categories.
    expect(catFind).not.toHaveBeenCalled();
  });
});
