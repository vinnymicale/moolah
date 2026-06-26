// Unit tests for the duplicate-transaction scanner and remover. The grouping
// logic (same account/date/amount/type/description -> one group, keep the
// oldest) is the correctness-critical part, so the Prisma layer is mocked and
// the assertions focus on which rows are grouped and which id is kept.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { scanDuplicateTransactions, removeDuplicateTransactions } from "./dedup-transactions";
import { prisma } from "@/lib/prisma";

const findMany = vi.mocked(prisma.transaction.findMany);
const deleteMany = vi.mocked(prisma.transaction.deleteMany);
const updateMany = vi.mocked(prisma.transaction.updateMany);

// Build a row in the shape scanDuplicateTransactions selects. createdAt drives
// which copy is kept (oldest wins).
function row(opts: {
  id: string;
  accountId?: string;
  date?: string;
  amount?: number;
  type?: string;
  description?: string;
  createdAt: string;
  accountName?: string | null;
}) {
  return {
    id: opts.id,
    accountId: opts.accountId ?? "a1",
    date: new Date(`${opts.date ?? "2026-05-30"}T00:00:00.000Z`),
    amount: opts.amount ?? 10,
    description: opts.description ?? "COFFEE",
    type: opts.type ?? "EXPENSE",
    createdAt: new Date(opts.createdAt),
    account: { name: opts.accountName ?? "Checking" },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("scanDuplicateTransactions", () => {
  it("groups rows with the same content and keeps the oldest", async () => {
    findMany.mockResolvedValueOnce([
      row({ id: "old", createdAt: "2026-06-01T00:00:00Z" }),
      row({ id: "new", createdAt: "2026-06-25T00:00:00Z" }),
    ] as never);

    const { groups, removableCount } = await scanDuplicateTransactions("u1");

    expect(removableCount).toBe(1);
    expect(groups).toHaveLength(1);
    expect(groups[0].keepId).toBe("old");
    expect(groups[0].removeIds).toEqual(["new"]);
  });

  it("does not group rows that differ on any signature field", async () => {
    findMany.mockResolvedValueOnce([
      row({ id: "a", amount: 10, createdAt: "2026-06-01T00:00:00Z" }),
      row({ id: "b", amount: 11, createdAt: "2026-06-02T00:00:00Z" }),
      row({ id: "c", description: "TEA", createdAt: "2026-06-03T00:00:00Z" }),
      row({ id: "d", accountId: "a2", createdAt: "2026-06-04T00:00:00Z" }),
      row({ id: "e", date: "2026-05-31", createdAt: "2026-06-05T00:00:00Z" }),
    ] as never);

    const { groups, removableCount } = await scanDuplicateTransactions("u1");

    expect(removableCount).toBe(0);
    expect(groups).toHaveLength(0);
  });

  it("removes every copy past the oldest when a charge has more than two", async () => {
    findMany.mockResolvedValueOnce([
      row({ id: "1", createdAt: "2026-06-01T00:00:00Z" }),
      row({ id: "2", createdAt: "2026-06-02T00:00:00Z" }),
      row({ id: "3", createdAt: "2026-06-03T00:00:00Z" }),
    ] as never);

    const { groups, removableCount } = await scanDuplicateTransactions("u1");

    expect(removableCount).toBe(2);
    expect(groups[0].keepId).toBe("1");
    expect(groups[0].removeIds).toEqual(["2", "3"]);
  });

  it("only scans the user's non-deleted, plaid-sourced rows", async () => {
    findMany.mockResolvedValueOnce([] as never);
    await scanDuplicateTransactions("u1");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1", deletedAt: null, plaidTransactionId: { not: null } },
        orderBy: { createdAt: "asc" },
      }),
    );
  });
});

describe("removeDuplicateTransactions", () => {
  const twoCopies = [
    row({ id: "keep", createdAt: "2026-06-01T00:00:00Z" }),
    row({ id: "drop", createdAt: "2026-06-25T00:00:00Z" }),
  ];

  it("hard-deletes only the duplicate copies, scoped to the user", async () => {
    findMany.mockResolvedValueOnce(twoCopies as never);
    deleteMany.mockResolvedValueOnce({ count: 1 } as never);

    const removed = await removeDuplicateTransactions("u1", "hard");

    expect(removed).toBe(1);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["drop"] }, userId: "u1" } });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("soft-deletes (trashes) the duplicate copies", async () => {
    findMany.mockResolvedValueOnce(twoCopies as never);
    updateMany.mockResolvedValueOnce({ count: 1 } as never);

    const removed = await removeDuplicateTransactions("u1", "soft");

    expect(removed).toBe(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["drop"] }, userId: "u1", deletedAt: null },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("is a no-op when there is nothing to remove", async () => {
    findMany.mockResolvedValueOnce([] as never);
    const removed = await removeDuplicateTransactions("u1", "hard");
    expect(removed).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
