// Action-layer tests for transactions.ts. These cover the guards that wrap the
// DB writes - the demo-mode short-circuit (a safety boundary on every mutation),
// ownership/existence checks, transfer-pair validation, and the search query
// shaping - by stubbing the side-effecting imports (prisma, session, cache).
// The split validation is covered separately in transactions.normalizeSplits.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

// isDemoMode is toggled per-test via this mock.
const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    financialAccount: { findFirst: vi.fn() },
    category: { findFirst: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import {
  createTransactionAction,
  deleteTransactionAction,
  setClearedAction,
  bulkDeleteTransactionsAction,
  pairTransfersAction,
  unpairTransferAction,
  searchTransactionsAction,
  scanDuplicateTransactionsAction,
  removeDuplicateTransactionsAction,
  ignoreDuplicateGroupAction,
} from "./transactions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

const requireUserMock = vi.mocked(requireUser);
const txn = vi.mocked(prisma.transaction);

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  requireUserMock.mockResolvedValue({ userId: "u1" } as Awaited<ReturnType<typeof requireUser>>);
});

describe("demo-mode guard", () => {
  beforeEach(() => {
    demoMode.value = true;
  });

  it("createTransactionAction is a no-op success in demo mode", async () => {
    const result = await createTransactionAction({
      type: "EXPENSE",
      amount: 10,
      date: "2026-01-01",
      description: "x",
    });
    expect(result).toEqual({ ok: true });
    // No auth, no DB write happened.
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(txn.create).not.toHaveBeenCalled();
  });

  it("deleteTransactionAction is a no-op success in demo mode", async () => {
    expect(await deleteTransactionAction("t1")).toEqual({ ok: true });
    expect(txn.update).not.toHaveBeenCalled();
  });

  it("setClearedAction is a no-op success in demo mode", async () => {
    expect(await setClearedAction("t1", true)).toEqual({ ok: true });
    expect(txn.update).not.toHaveBeenCalled();
  });

  it("bulkDeleteTransactionsAction is a no-op success in demo mode", async () => {
    expect(await bulkDeleteTransactionsAction(["t1"])).toEqual({ ok: true });
    expect(txn.deleteMany).not.toHaveBeenCalled();
  });

  it("searchTransactionsAction returns no hits in demo mode", async () => {
    expect(await searchTransactionsAction("rent")).toEqual([]);
    expect(txn.findMany).not.toHaveBeenCalled();
  });

  it("scanDuplicateTransactionsAction returns an empty scan in demo mode", async () => {
    expect(await scanDuplicateTransactionsAction()).toEqual({ groups: [], removableCount: 0 });
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(txn.findMany).not.toHaveBeenCalled();
  });

  it("removeDuplicateTransactionsAction is a no-op success in demo mode", async () => {
    expect(await removeDuplicateTransactionsAction("hard", ["k1"])).toEqual({ ok: true });
    expect(txn.deleteMany).not.toHaveBeenCalled();
    expect(txn.updateMany).not.toHaveBeenCalled();
  });

  it("ignoreDuplicateGroupAction is a no-op success in demo mode", async () => {
    expect(await ignoreDuplicateGroupAction(["k1", "d1"])).toEqual({ ok: true });
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(txn.updateMany).not.toHaveBeenCalled();
  });
});

describe("existence / ownership checks", () => {
  it("deleteTransactionAction fails when the transaction isn't the user's", async () => {
    txn.findFirst.mockResolvedValue(null);
    const result = await deleteTransactionAction("t1");
    expect(result).toEqual({ ok: false, error: "Transaction not found" });
    expect(txn.update).not.toHaveBeenCalled();
    // Lookup is scoped to the caller and ignores already-trashed rows.
    expect(txn.findFirst).toHaveBeenCalledWith({ where: { id: "t1", userId: "u1", deletedAt: null } });
  });

  it("setClearedAction updates only after confirming ownership", async () => {
    txn.findFirst.mockResolvedValue({ id: "t1" } as never);
    txn.update.mockResolvedValue({} as never);
    const result = await setClearedAction("t1", false);
    expect(result).toEqual({ ok: true });
    expect(txn.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { cleared: false } });
  });
});

describe("pairTransfersAction", () => {
  it("rejects when the two transactions share a type", async () => {
    txn.findMany.mockResolvedValue([
      { id: "a", type: "EXPENSE", isTransfer: false },
      { id: "b", type: "EXPENSE", isTransfer: false },
    ] as never);
    const result = await pairTransfersAction("a", "b");
    expect(result).toEqual({ ok: false, error: "A transfer pair needs one expense and one income." });
  });

  it("rejects when either side is already a transfer", async () => {
    txn.findMany.mockResolvedValue([
      { id: "a", type: "EXPENSE", isTransfer: true },
      { id: "b", type: "INCOME", isTransfer: false },
    ] as never);
    const result = await pairTransfersAction("a", "b");
    expect(result).toEqual({ ok: false, error: "One of these is already part of a transfer pair." });
  });

  it("rejects when both ids don't resolve to the user's transactions", async () => {
    txn.findMany.mockResolvedValue([{ id: "a", type: "EXPENSE", isTransfer: false }] as never);
    const result = await pairTransfersAction("a", "b");
    expect(result).toEqual({ ok: false, error: "Transaction not found" });
  });

  it("links expense->income with transferPeerId on the expense side", async () => {
    txn.findMany.mockResolvedValue([
      { id: "exp", type: "EXPENSE", isTransfer: false },
      { id: "inc", type: "INCOME", isTransfer: false },
    ] as never);
    const $transaction = vi.mocked(prisma.$transaction);
    $transaction.mockResolvedValue([] as never);
    txn.update.mockReturnValue({} as never);

    const result = await pairTransfersAction("exp", "inc");
    expect(result).toEqual({ ok: true });
    expect(txn.update).toHaveBeenCalledWith({
      where: { id: "exp" },
      data: { isTransfer: true, transferPeerId: "inc" },
    });
    expect(txn.update).toHaveBeenCalledWith({
      where: { id: "inc" },
      data: { isTransfer: true },
    });
  });
});

describe("unpairTransferAction", () => {
  it("rejects a transaction that isn't part of a pair", async () => {
    txn.findFirst.mockResolvedValue({ id: "t1", isTransfer: false } as never);
    const result = await unpairTransferAction("t1");
    expect(result).toEqual({ ok: false, error: "This transaction is not part of a transfer pair." });
  });

  it("clears both sides when a peer exists", async () => {
    txn.findFirst.mockResolvedValue({
      id: "t1",
      isTransfer: true,
      transferPeer: { id: "t2" },
      transferPeerOf: null,
    } as never);
    const $transaction = vi.mocked(prisma.$transaction);
    $transaction.mockResolvedValue([] as never);
    txn.update.mockReturnValue({} as never);

    const result = await unpairTransferAction("t1");
    expect(result).toEqual({ ok: true });
    expect(txn.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { isTransfer: false, transferPeerId: null },
    });
    expect(txn.update).toHaveBeenCalledWith({
      where: { id: "t2" },
      data: { isTransfer: false, transferPeerId: null },
    });
  });
});

describe("searchTransactionsAction", () => {
  it("returns [] for queries shorter than two characters", async () => {
    expect(await searchTransactionsAction("a")).toEqual([]);
    expect(await searchTransactionsAction("   ")).toEqual([]);
    expect(txn.findMany).not.toHaveBeenCalled();
  });

  it("adds an amount clause when the query parses as a positive number", async () => {
    txn.findMany.mockResolvedValue([] as never);
    await searchTransactionsAction("$42.50");
    const arg = txn.findMany.mock.calls[0][0] as { where: { OR: unknown[] } };
    // description + note + the amount range = 3 OR clauses.
    expect(arg.where.OR).toHaveLength(3);
    expect(arg.where.OR).toContainEqual({ amount: { gte: 42.5 - 0.005, lte: 42.5 + 0.005 } });
  });

  it("omits the amount clause for non-numeric queries", async () => {
    txn.findMany.mockResolvedValue([] as never);
    await searchTransactionsAction("groceries");
    const arg = txn.findMany.mock.calls[0][0] as { where: { OR: unknown[] } };
    expect(arg.where.OR).toHaveLength(2);
  });

  it("maps rows to SearchHit with ISO date and numeric amount", async () => {
    txn.findMany.mockResolvedValue([
      {
        id: "t1",
        date: new Date("2026-03-04T00:00:00Z"),
        description: "Rent",
        amount: "1500.00",
        type: "EXPENSE",
        categoryId: "c1",
        accountId: "a1",
        note: null,
      },
    ] as never);
    const hits = await searchTransactionsAction("rent");
    expect(hits).toEqual([
      {
        id: "t1",
        date: "2026-03-04",
        description: "Rent",
        amount: 1500,
        type: "EXPENSE",
        categoryId: "c1",
        accountId: "a1",
        note: null,
      },
    ]);
  });
});
