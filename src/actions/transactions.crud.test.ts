// Covers the write paths of transactions.ts that transactions.test.ts (guards,
// pairing, search) and transactions.normalizeSplits.test.ts leave out: the
// create/update bodies including recurring rules and splits, trash lifecycle,
// bulk operations, convert-to-recurring, and occurrence materialization.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));

const getDeletedMock = vi.fn();
vi.mock("@/lib/queries", () => ({
  getDeletedTransactions: (userId: string) => getDeletedMock(userId),
}));

const dedup = {
  scan: vi.fn(),
  remove: vi.fn(),
  ignore: vi.fn(),
};
vi.mock("@/lib/dedup-transactions", () => ({
  scanDuplicateTransactions: (userId: string) => dedup.scan(userId),
  removeDuplicateTransactions: (userId: string, mode: string, keepIds: string[]) =>
    dedup.remove(userId, mode, keepIds),
  ignoreDuplicateGroup: (userId: string, ids: string[]) => dedup.ignore(userId, ids),
}));

vi.mock("@/lib/prisma", () => {
  const client = {
    transaction: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
    },
    transactionSplit: { deleteMany: vi.fn() },
    recurringRule: { create: vi.fn(), findFirst: vi.fn() },
    financialAccount: { findFirst: vi.fn() },
    category: { findFirst: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  };
  // Interactive transactions get the same client; array form just awaits all.
  client.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? arg(client) : Promise.all(arg as Promise<unknown>[]),
  );
  return { prisma: client };
});

import {
  createTransactionAction,
  updateTransactionAction,
  restoreTransactionAction,
  permanentDeleteTransactionAction,
  listDeletedTransactionsAction,
  scanDuplicateTransactionsAction,
  removeDuplicateTransactionsAction,
  ignoreDuplicateGroupAction,
  bulkSetCategoryAction,
  bulkSetAccountAction,
  bulkSetClearedAction,
  bulkDeleteTransactionsAction,
  convertToRecurringAction,
  materializeOccurrenceAction,
} from "./transactions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

const requireUserMock = vi.mocked(requireUser);
const txn = vi.mocked(prisma.transaction);
const splitRow = vi.mocked(prisma.transactionSplit);
const recurring = vi.mocked(prisma.recurringRule);
const account = vi.mocked(prisma.financialAccount);
const category = vi.mocked(prisma.category);

const baseInput = {
  type: "EXPENSE" as const,
  amount: 25,
  date: "2026-07-01",
  description: "Coffee beans",
};

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  requireUserMock.mockResolvedValue({ userId: "u1" } as Awaited<ReturnType<typeof requireUser>>);
  recurring.create.mockResolvedValue({ id: "rr1" } as never);
  txn.create.mockResolvedValue({ id: "t1" } as never);
});

describe("createTransactionAction", () => {
  it("creates a plain transaction with parsed date and cleared defaulting to true", async () => {
    const result = await createTransactionAction(baseInput);

    expect(result).toEqual({ ok: true, id: "t1" });
    const data = txn.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: "u1",
      accountId: null,
      categoryId: null,
      type: "EXPENSE",
      amount: 25,
      description: "Coffee beans",
      cleared: true,
      recurringRuleId: undefined,
    });
    expect(data.date).toBeInstanceOf(Date);
    expect(data.splits).toBeUndefined();
  });

  it("rejects a non-positive amount via schema validation", async () => {
    const result = await createTransactionAction({ ...baseInput, amount: 0 });
    expect(result).toEqual({ ok: false, error: "Amount must be greater than zero" });
    expect(txn.create).not.toHaveBeenCalled();
  });

  it("rejects an account the user doesn't own", async () => {
    account.findFirst.mockResolvedValue(null);
    const result = await createTransactionAction({ ...baseInput, accountId: "acc-other" });
    expect(result).toEqual({ ok: false, error: "Account not found" });
    expect(account.findFirst).toHaveBeenCalledWith({ where: { id: "acc-other", userId: "u1" } });
    expect(txn.create).not.toHaveBeenCalled();
  });

  it("requires the category's kind to match the transaction type", async () => {
    category.findFirst.mockResolvedValue(null);
    const result = await createTransactionAction({ ...baseInput, categoryId: "cat-income" });
    expect(result).toEqual({ ok: false, error: "Category not found" });
    expect(category.findFirst).toHaveBeenCalledWith({
      where: { id: "cat-income", userId: "u1", kind: "EXPENSE" },
    });
  });

  it("creates the recurring rule first and links the transaction to it", async () => {
    const result = await createTransactionAction({
      ...baseInput,
      recurring: { frequency: "MONTHLY", interval: 1, dayOfMonth: 1 },
    });

    expect(result).toEqual({ ok: true, id: "t1" });
    expect(recurring.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        type: "EXPENSE",
        amount: 25,
        description: "Coffee beans",
        frequency: "MONTHLY",
        interval: 1,
        dayOfMonth: 1,
        weekday: null,
        endDate: null,
      }),
    });
    expect(txn.create.mock.calls[0][0].data.recurringRuleId).toBe("rr1");
  });

  it("stores splits on the child rows and clears the parent category", async () => {
    category.findFirst.mockResolvedValue({ id: "cat1" } as never);
    category.count.mockResolvedValue(2 as never);

    const result = await createTransactionAction({
      ...baseInput,
      categoryId: "cat1",
      splits: [
        { categoryId: "cat1", amount: 10 },
        { categoryId: "cat2", amount: 15 },
      ],
    });

    expect(result).toEqual({ ok: true, id: "t1" });
    const data = txn.create.mock.calls[0][0].data;
    expect(data.categoryId).toBeNull();
    expect(data.splits).toEqual({
      create: [
        { categoryId: "cat1", amount: 10 },
        { categoryId: "cat2", amount: 15 },
      ],
    });
  });

  it("rejects splits whose categories aren't all the user's", async () => {
    category.count.mockResolvedValue(1 as never);
    const result = await createTransactionAction({
      ...baseInput,
      splits: [
        { categoryId: "cat1", amount: 10 },
        { categoryId: "cat-foreign", amount: 15 },
      ],
    });
    expect(result).toEqual({ ok: false, error: "Split category not found" });
    expect(txn.create).not.toHaveBeenCalled();
  });
});

describe("updateTransactionAction", () => {
  it("errors when the transaction isn't the user's", async () => {
    txn.findFirst.mockResolvedValue(null);
    const result = await updateTransactionAction("t1", baseInput);
    expect(result).toEqual({ ok: false, error: "Transaction not found" });
    expect(txn.update).not.toHaveBeenCalled();
  });

  it("replaces splits wholesale and rewrites the row", async () => {
    txn.findFirst.mockResolvedValue({ id: "t1", cleared: false } as never);
    const result = await updateTransactionAction("t1", { ...baseInput, cleared: false });

    expect(result).toEqual({ ok: true });
    expect(splitRow.deleteMany).toHaveBeenCalledWith({ where: { transactionId: "t1" } });
    expect(txn.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: expect.objectContaining({
        accountId: null,
        categoryId: null,
        amount: 25,
        description: "Coffee beans",
        cleared: false,
      }),
    });
  });
});

describe("trash lifecycle", () => {
  it("restoreTransactionAction only restores rows that are actually trashed", async () => {
    txn.findFirst.mockResolvedValue(null);
    const result = await restoreTransactionAction("t1");
    expect(result).toEqual({ ok: false, error: "Transaction not found" });
    expect(txn.findFirst).toHaveBeenCalledWith({
      where: { id: "t1", userId: "u1", deletedAt: { not: null } },
    });
  });

  it("restoreTransactionAction nulls deletedAt", async () => {
    txn.findFirst.mockResolvedValue({ id: "t1" } as never);
    expect(await restoreTransactionAction("t1")).toEqual({ ok: true });
    expect(txn.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { deletedAt: null } });
  });

  it("permanentDeleteTransactionAction hard-deletes a trashed row", async () => {
    txn.findFirst.mockResolvedValue({ id: "t1" } as never);
    expect(await permanentDeleteTransactionAction("t1")).toEqual({ ok: true });
    expect(txn.delete).toHaveBeenCalledWith({ where: { id: "t1" } });
  });

  it("listDeletedTransactionsAction returns the user's trash", async () => {
    getDeletedMock.mockResolvedValue([{ id: "t1" }]);
    expect(await listDeletedTransactionsAction()).toEqual([{ id: "t1" }]);
    expect(getDeletedMock).toHaveBeenCalledWith("u1");
  });
});

describe("duplicate cleanup delegates to the dedup lib with the caller's id", () => {
  it("scan", async () => {
    dedup.scan.mockResolvedValue({ groups: [], removableCount: 0 });
    await scanDuplicateTransactionsAction();
    expect(dedup.scan).toHaveBeenCalledWith("u1");
  });

  it("remove", async () => {
    expect(await removeDuplicateTransactionsAction("soft", ["k1"])).toEqual({ ok: true });
    expect(dedup.remove).toHaveBeenCalledWith("u1", "soft", ["k1"]);
  });

  it("ignore", async () => {
    expect(await ignoreDuplicateGroupAction(["a", "b"])).toEqual({ ok: true });
    expect(dedup.ignore).toHaveBeenCalledWith("u1", ["a", "b"]);
  });
});

describe("bulk operations", () => {
  it("bulkSetCategoryAction rejects an empty selection", async () => {
    const result = await bulkSetCategoryAction([], "cat1");
    expect(result).toEqual({ ok: false, error: "Select at least one transaction" });
    expect(txn.updateMany).not.toHaveBeenCalled();
  });

  it("bulkSetCategoryAction rejects a category the user doesn't own", async () => {
    category.findFirst.mockResolvedValue(null);
    const result = await bulkSetCategoryAction(["t1"], "cat-foreign");
    expect(result).toEqual({ ok: false, error: "Category not found" });
  });

  it("bulkSetCategoryAction clears splits and recategorizes in one transaction", async () => {
    category.findFirst.mockResolvedValue({ id: "cat1" } as never);
    const result = await bulkSetCategoryAction(["t1", "t2"], "cat1");

    expect(result).toEqual({ ok: true });
    expect(splitRow.deleteMany).toHaveBeenCalledWith({
      where: { transaction: { userId: "u1", id: { in: ["t1", "t2"] } } },
    });
    expect(txn.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", id: { in: ["t1", "t2"] } },
      data: { categoryId: "cat1" },
    });
  });

  it("bulkSetCategoryAction allows clearing to uncategorized without a lookup", async () => {
    expect(await bulkSetCategoryAction(["t1"], null)).toEqual({ ok: true });
    expect(category.findFirst).not.toHaveBeenCalled();
    expect(txn.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", id: { in: ["t1"] } },
      data: { categoryId: null },
    });
  });

  it("bulkSetAccountAction rejects an account the user doesn't own", async () => {
    account.findFirst.mockResolvedValue(null);
    expect(await bulkSetAccountAction(["t1"], "acc-foreign")).toEqual({
      ok: false,
      error: "Account not found",
    });
  });

  it("bulkSetAccountAction moves the selection", async () => {
    account.findFirst.mockResolvedValue({ id: "acc1" } as never);
    expect(await bulkSetAccountAction(["t1"], "acc1")).toEqual({ ok: true });
    expect(txn.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", id: { in: ["t1"] } },
      data: { accountId: "acc1" },
    });
  });

  it("bulkSetClearedAction updates the selection", async () => {
    expect(await bulkSetClearedAction(["t1", "t2"], true)).toEqual({ ok: true });
    expect(txn.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", id: { in: ["t1", "t2"] } },
      data: { cleared: true },
    });
  });

  it("bulkDeleteTransactionsAction soft-deletes only rows not already trashed", async () => {
    expect(await bulkDeleteTransactionsAction(["t1"])).toEqual({ ok: true });
    const args = txn.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: "u1", id: { in: ["t1"] }, deletedAt: null });
    expect(args.data.deletedAt).toBeInstanceOf(Date);
  });
});

describe("convertToRecurringAction", () => {
  const sourceTxn = {
    id: "t1",
    accountId: "acc1",
    categoryId: "cat1",
    type: "EXPENSE",
    amount: 15.99,
    description: "Netflix",
    note: null,
    date: new Date("2026-06-15T00:00:00Z"),
    recurringRuleId: null,
  };

  it("errors when the transaction isn't the user's", async () => {
    txn.findFirst.mockResolvedValue(null);
    expect(await convertToRecurringAction("t1", { frequency: "MONTHLY" })).toEqual({
      ok: false,
      error: "Transaction not found",
    });
  });

  it("refuses to convert a transaction already in a series", async () => {
    txn.findFirst.mockResolvedValue({ ...sourceTxn, recurringRuleId: "rr9" } as never);
    expect(await convertToRecurringAction("t1", { frequency: "MONTHLY" })).toEqual({
      ok: false,
      error: "This transaction is already part of a recurring series.",
    });
    expect(recurring.create).not.toHaveBeenCalled();
  });

  it("builds the rule from the transaction's own fields and links it back", async () => {
    txn.findFirst.mockResolvedValue(sourceTxn as never);
    const result = await convertToRecurringAction("t1", { frequency: "MONTHLY", dayOfMonth: 15 });

    expect(result).toEqual({ ok: true });
    expect(recurring.create).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        accountId: "acc1",
        categoryId: "cat1",
        type: "EXPENSE",
        amount: 15.99,
        description: "Netflix",
        note: null,
        frequency: "MONTHLY",
        interval: 1,
        dayOfMonth: 15,
        weekday: null,
        startDate: sourceTxn.date,
        endDate: null,
      },
    });
    expect(txn.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { recurringRuleId: "rr1" },
    });
  });
});

describe("materializeOccurrenceAction", () => {
  const rule = {
    id: "rr1",
    accountId: "acc1",
    categoryId: "cat1",
    type: "EXPENSE",
    amount: 1200,
    description: "Rent",
    note: null,
  };

  it("errors when the rule isn't the user's", async () => {
    recurring.findFirst.mockResolvedValue(null);
    expect(await materializeOccurrenceAction("rr1", "2026-07-01")).toEqual({
      ok: false,
      error: "Recurring rule not found",
    });
  });

  it("creates a concrete transaction from the rule's fields", async () => {
    recurring.findFirst.mockResolvedValue(rule as never);
    txn.findFirst.mockResolvedValue(null);

    const result = await materializeOccurrenceAction("rr1", "2026-07-01");

    expect(result).toEqual({ ok: true });
    const data = txn.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: "u1",
      accountId: "acc1",
      categoryId: "cat1",
      type: "EXPENSE",
      amount: 1200,
      description: "Rent",
      cleared: true,
      recurringRuleId: "rr1",
    });
    expect(data.date).toBeInstanceOf(Date);
  });

  it("is idempotent: an existing occurrence just gets its cleared flag set", async () => {
    recurring.findFirst.mockResolvedValue(rule as never);
    txn.findFirst.mockResolvedValue({ id: "t-existing" } as never);

    expect(await materializeOccurrenceAction("rr1", "2026-07-01", false)).toEqual({ ok: true });
    expect(txn.create).not.toHaveBeenCalled();
    expect(txn.update).toHaveBeenCalledWith({
      where: { id: "t-existing" },
      data: { cleared: false },
    });
  });
});
