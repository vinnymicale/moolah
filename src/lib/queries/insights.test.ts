// Both of these turn a month of transactions into a ranked list, and both have
// thresholds that decide what a user actually sees: the anomaly rules (40% over,
// $30 absolute, two prior months of real data) and the merchant rollup's
// case-insensitive keying. Split transactions attribute to the child rows, which
// is easy to regress.

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { getSpendingAnomalies, getTopMerchants } from "./insights";

type MockedDelegates = Record<string, Record<string, Mock>>;
const db = prisma as unknown as MockedDelegates;

function txn(categoryId: string | null, amount: number, splits: { categoryId: string; amount: number }[] = []) {
  return { categoryId, amount, splits };
}

/**
 * Answers the current month with `current`, then the three prior months with
 * the successive entries of `history`.
 */
function months(current: ReturnType<typeof txn>[], history: ReturnType<typeof txn>[][]) {
  db.transaction.findMany.mockResolvedValueOnce(current);
  for (const h of history) db.transaction.findMany.mockResolvedValueOnce(h);
}

const cat = (id: string, name: string) => ({ id, name, color: "#111", icon: "shopping-cart" });

beforeEach(() => {
  vi.clearAllMocks();
  db.transaction.findMany.mockResolvedValue([]);
  db.category.findMany.mockResolvedValue([]);
});

describe("getSpendingAnomalies", () => {
  it("returns nothing when the month has no cleared spend", async () => {
    db.transaction.findMany.mockResolvedValue([]);
    expect(await getSpendingAnomalies("u1", "2026-09")).toEqual([]);
    // Bails before touching the three history months.
    expect(db.transaction.findMany).toHaveBeenCalledTimes(1);
  });

  it("queries only the caller's cleared, non-transfer expenses for the month", async () => {
    await getSpendingAnomalies("u1", "2026-09");
    const where = db.transaction.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe("u1");
    expect(where.deletedAt).toBeNull();
    expect(where.type).toBe("EXPENSE");
    expect(where.cleared).toBe(true);
    expect(where.isTransfer).toBe(false);
    expect((where.date.gte as Date).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("flags a category well over its three-month average", async () => {
    months([txn("c1", 300)], [[txn("c1", 100)], [txn("c1", 100)], [txn("c1", 100)]]);
    db.category.findMany.mockResolvedValue([cat("c1", "Groceries")]);

    const [a] = await getSpendingAnomalies("u1", "2026-09");
    expect(a.name).toBe("Groceries");
    expect(a.thisMonth).toBe(300);
    expect(a.avg3Month).toBe(100);
    expect(a.overBy).toBe(200);
    expect(a.overPct).toBe(200);
  });

  it("ignores an overage under 40 percent", async () => {
    months([txn("c1", 130)], [[txn("c1", 100)], [txn("c1", 100)], [txn("c1", 100)]]);
    db.category.findMany.mockResolvedValue([cat("c1", "Groceries")]);
    expect(await getSpendingAnomalies("u1", "2026-09")).toEqual([]);
  });

  it("ignores a large percentage that is small in dollars", async () => {
    // Triple the average, but only $20 more. Not worth a notification.
    months([txn("c1", 30)], [[txn("c1", 10)], [txn("c1", 10)], [txn("c1", 10)]]);
    db.category.findMany.mockResolvedValue([cat("c1", "Coffee")]);
    expect(await getSpendingAnomalies("u1", "2026-09")).toEqual([]);
  });

  it("needs two prior months with real spend before calling anything unusual", async () => {
    months([txn("c1", 400)], [[txn("c1", 100)], [], []]);
    db.category.findMany.mockResolvedValue([cat("c1", "Groceries")]);
    expect(await getSpendingAnomalies("u1", "2026-09")).toEqual([]);

    vi.clearAllMocks();
    months([txn("c1", 400)], [[txn("c1", 100)], [txn("c1", 100)], []]);
    db.category.findMany.mockResolvedValue([cat("c1", "Groceries")]);
    expect(await getSpendingAnomalies("u1", "2026-09")).toHaveLength(1);
  });

  it("attributes split transactions to their child categories", async () => {
    // A $300 parent with a null category, split across two categories. Only c1
    // is over its average; c2 tracks its own history.
    months(
      [txn(null, 300, [{ categoryId: "c1", amount: 250 }, { categoryId: "c2", amount: 50 }])],
      [
        [txn(null, 100, [{ categoryId: "c1", amount: 50 }, { categoryId: "c2", amount: 50 }])],
        [txn(null, 100, [{ categoryId: "c1", amount: 50 }, { categoryId: "c2", amount: 50 }])],
        [txn(null, 100, [{ categoryId: "c1", amount: 50 }, { categoryId: "c2", amount: 50 }])],
      ],
    );
    db.category.findMany.mockResolvedValue([cat("c1", "Groceries"), cat("c2", "Household")]);

    const out = await getSpendingAnomalies("u1", "2026-09");
    expect(out.map((a) => a.name)).toEqual(["Groceries"]);
    expect(out[0].thisMonth).toBe(250);
    expect(out[0].avg3Month).toBe(50);
  });

  it("drops a category the user no longer has", async () => {
    months([txn("gone", 300)], [[txn("gone", 100)], [txn("gone", 100)], [txn("gone", 100)]]);
    db.category.findMany.mockResolvedValue([]);
    expect(await getSpendingAnomalies("u1", "2026-09")).toEqual([]);
  });

  it("ranks the worst overage first", async () => {
    months(
      [txn("c1", 200), txn("c2", 500)],
      [
        [txn("c1", 100), txn("c2", 100)],
        [txn("c1", 100), txn("c2", 100)],
        [txn("c1", 100), txn("c2", 100)],
      ],
    );
    db.category.findMany.mockResolvedValue([cat("c1", "Groceries"), cat("c2", "Dining")]);

    const out = await getSpendingAnomalies("u1", "2026-09");
    expect(out.map((a) => a.name)).toEqual(["Dining", "Groceries"]);
  });
});

describe("getTopMerchants", () => {
  function merchant(description: string, amount: number, categoryId: string | null = "c1") {
    return { description, amount, categoryId };
  }

  it("rolls up a payee case-insensitively, keeping the first spelling", async () => {
    db.transaction.findMany.mockResolvedValue([
      merchant("Trader Joe's", 40),
      merchant("TRADER JOE'S", 25),
      merchant("  trader joe's  ", 10),
    ]);

    const out = await getTopMerchants("u1", "2026-09");
    expect(out).toHaveLength(1);
    expect(out[0].description).toBe("Trader Joe's");
    expect(out[0].amount).toBe(75);
    expect(out[0].count).toBe(3);
  });

  it("ranks by total spend, not visit count", async () => {
    db.transaction.findMany.mockResolvedValue([
      merchant("Corner Store", 5),
      merchant("Corner Store", 5),
      merchant("Corner Store", 5),
      merchant("Car Repair", 400),
    ]);

    const out = await getTopMerchants("u1", "2026-09");
    expect(out.map((m) => m.description)).toEqual(["Car Repair", "Corner Store"]);
  });

  it("honours the limit and defaults to six", async () => {
    const rows = Array.from({ length: 9 }, (_, i) => merchant(`Payee ${i}`, 100 - i));
    db.transaction.findMany.mockResolvedValue(rows);

    expect(await getTopMerchants("u1", "2026-09")).toHaveLength(6);
    expect(await getTopMerchants("u1", "2026-09", 3)).toHaveLength(3);
  });

  it("queries only the caller's cleared, non-transfer expenses for the month", async () => {
    await getTopMerchants("u1", "2026-09");
    const where = db.transaction.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe("u1");
    expect(where.deletedAt).toBeNull();
    expect(where.type).toBe("EXPENSE");
    expect(where.cleared).toBe(true);
    expect(where.isTransfer).toBe(false);
    expect((where.date.gte as Date).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("returns nothing for a quiet month", async () => {
    db.transaction.findMany.mockResolvedValue([]);
    expect(await getTopMerchants("u1", "2026-09")).toEqual([]);
  });
});
