// Targeted tests for the most logic-heavy read function:
//   - getSpendingAnomalies: the ≥40%-over AND ≥$30-over detection that buckets
//     split parts in JS (split parents carry a null categoryId).
//
// Prisma is mocked per-call. Each test wires only the queries the function under
// test actually makes, in call order where the code relies on it.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { getSpendingAnomalies, getTransactionsBetween } from "./queries";

const txnFind = vi.mocked(prisma.transaction.findMany);
const catFind = vi.mocked(prisma.category.findMany);

beforeEach(() => {
  vi.clearAllMocks();
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

describe("soft-delete exclusion", () => {
  // Reads must never surface trashed rows. Each transaction.findMany call these
  // getters make has to carry deletedAt: null in its where-clause, otherwise a
  // soft-deleted transaction would leak back into balances and totals.
  it("getTransactionsBetween scopes its query to non-deleted rows", async () => {
    txnFind.mockResolvedValueOnce([] as never);
    await getTransactionsBetween("u1", "2026-06-01", "2026-06-30");
    expect(txnFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "u1", deletedAt: null }),
      }),
    );
  });

  it("getSpendingAnomalies excludes deleted rows from every month it sums", async () => {
    // current month + three history months = 4 findMany calls.
    txnFind.mockResolvedValue([] as never);
    await getSpendingAnomalies("u1", "2026-06");
    for (const call of txnFind.mock.calls) {
      expect(call[0]).toEqual(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
        }),
      );
    }
  });
});
