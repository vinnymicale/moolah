// Staging resolves names into ids without touching the database; committing
// writes but only after re-checking every id belongs to the caller. Both halves
// matter: the descriptor between them round-trips through the browser.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { findFirst: vi.fn() },
    account: { findFirst: vi.fn() },
    transaction: { create: vi.fn() },
    recurringRule: { create: vi.fn() },
    budget: { upsert: vi.fn() },
  },
}));
vi.mock("@/lib/queries", () => ({ getCategories: vi.fn(), getAccounts: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { getCategories, getAccounts } from "@/lib/queries";
import {
  isWriteTool,
  stageWrite,
  commitWrite,
  stagedWriteSchema,
  type StagedWrite,
} from "./chat-writes";

const categories = vi.mocked(getCategories);
const accounts = vi.mocked(getAccounts);
const findCategory = vi.mocked(prisma.category.findFirst);
const findAccount = vi.mocked(prisma.account.findFirst);

beforeEach(() => {
  vi.clearAllMocks();
  categories.mockResolvedValue([{ id: "c1", name: "Groceries" }] as never);
  accounts.mockResolvedValue([{ id: "a1", name: "Checking" }] as never);
  findCategory.mockResolvedValue({ id: "c1" } as never);
  findAccount.mockResolvedValue({ id: "a1" } as never);
});

describe("isWriteTool", () => {
  it("recognises the three write tools", () => {
    expect(isWriteTool("create_transaction")).toBe(true);
    expect(isWriteTool("create_recurring_rule")).toBe(true);
    expect(isWriteTool("set_budget")).toBe(true);
  });
  it("rejects read tools", () => {
    expect(isWriteTool("get_spending_by_category")).toBe(false);
  });
});

describe("stageWrite - create_transaction", () => {
  const args = {
    type: "EXPENSE",
    amount: 42.5,
    date: "2026-06-01",
    description: "Market run",
    category_name: "grocer",
    account_name: "check",
  };

  it("resolves names to ids and writes nothing", async () => {
    const { staged } = await stageWrite("create_transaction", args, "u1");
    expect(staged?.tool).toBe("create_transaction");
    expect(staged?.payload).toMatchObject({ categoryId: "c1", accountId: "a1", cleared: true });
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it("describes the change for the confirm card", async () => {
    const { staged } = await stageWrite("create_transaction", args, "u1");
    expect(staged?.summary).toContain("Market run");
    expect(staged?.fields).toContainEqual({ label: "Category", value: "Groceries" });
  });

  it("tells the model the write has not happened yet", async () => {
    const { toolResult } = await stageWrite("create_transaction", args, "u1");
    const parsed = JSON.parse(toolResult);
    expect(parsed.staged).toBe(true);
    expect(parsed.message).toMatch(/NOT yet saved/);
  });

  it("leaves unmatched names null rather than guessing", async () => {
    const { staged } = await stageWrite(
      "create_transaction",
      { ...args, category_name: "nope", account_name: "nope" },
      "u1",
    );
    expect(staged?.payload).toMatchObject({ categoryId: null, accountId: null });
  });

  it("rejects arguments the model got wrong", async () => {
    await expect(
      stageWrite("create_transaction", { ...args, amount: -5 }, "u1"),
    ).rejects.toThrow();
  });

  it("produces a descriptor that survives the round trip", async () => {
    const { staged } = await stageWrite("create_transaction", args, "u1");
    expect(stagedWriteSchema.parse(JSON.parse(JSON.stringify(staged)))).toEqual(staged);
  });
});

describe("stageWrite - create_recurring_rule", () => {
  const args = {
    type: "EXPENSE",
    amount: 15.99,
    description: "Netflix",
    frequency: "MONTHLY",
    start_date: "2026-06-01",
    category_name: "grocer",
  };

  it("defaults the interval to 1", async () => {
    const { staged } = await stageWrite("create_recurring_rule", args, "u1");
    expect(staged?.payload).toMatchObject({ interval: 1, dayOfMonth: null });
    expect(prisma.recurringRule.create).not.toHaveBeenCalled();
  });

  it("spells out a multi-cycle interval in the summary", async () => {
    const { staged } = await stageWrite("create_recurring_rule", { ...args, interval: 3 }, "u1");
    expect(staged?.summary).toContain("every 3 monthly cycles");
  });
});

describe("stageWrite - set_budget", () => {
  it("stages against the matched category", async () => {
    const { staged } = await stageWrite(
      "set_budget",
      { category_name: "grocer", limit: 500, month: "2026-06" },
      "u1",
    );
    expect(staged?.payload).toEqual({ categoryId: "c1", limit: 500, month: "2026-06" });
  });

  it("stages nothing and sends the model back when no category matches", async () => {
    const { staged, toolResult } = await stageWrite(
      "set_budget",
      { category_name: "spaceships", limit: 500 },
      "u1",
    );
    expect(staged).toBeNull();
    expect(JSON.parse(toolResult).success).toBe(false);
  });

  it("falls back to the current month", async () => {
    const { staged } = await stageWrite("set_budget", { category_name: "grocer", limit: 500 }, "u1");
    expect(staged?.payload).toMatchObject({ month: expect.stringMatching(/^\d{4}-\d{2}$/) });
  });
});

const txnWrite: StagedWrite = {
  id: "w1",
  summary: "Expense: Market run for $42.50",
  fields: [],
  tool: "create_transaction",
  payload: {
    type: "EXPENSE",
    amount: 42.5,
    date: "2026-06-01",
    description: "Market run",
    note: null,
    categoryId: "c1",
    accountId: "a1",
    cleared: true,
  },
};

describe("commitWrite", () => {
  it("creates the transaction once ownership checks out", async () => {
    const message = await commitWrite(txnWrite, "u1");
    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "u1", categoryId: "c1", accountId: "a1" }),
    });
    expect(message).toContain("Market run");
  });

  it("refuses a category belonging to someone else", async () => {
    findCategory.mockResolvedValue(null as never);
    await expect(commitWrite(txnWrite, "u1")).rejects.toThrow(/Unknown category/);
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it("refuses an account belonging to someone else", async () => {
    findAccount.mockResolvedValue(null as never);
    await expect(commitWrite(txnWrite, "u1")).rejects.toThrow(/Unknown category or account/);
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it("skips the lookup when there is no id to check", async () => {
    await commitWrite({ ...txnWrite, payload: { ...txnWrite.payload, categoryId: null, accountId: null } }, "u1");
    expect(findCategory).not.toHaveBeenCalled();
    expect(findAccount).not.toHaveBeenCalled();
  });

  it("creates a recurring rule with its first version", async () => {
    await commitWrite(
      {
        id: "w2",
        summary: "Recurring expense: Netflix",
        fields: [],
        tool: "create_recurring_rule",
        payload: {
          type: "EXPENSE",
          amount: 15.99,
          description: "Netflix",
          frequency: "MONTHLY",
          interval: 1,
          startDate: "2026-06-01",
          dayOfMonth: null,
          categoryId: "c1",
          accountId: null,
        },
      },
      "u1",
    );
    const arg = vi.mocked(prisma.recurringRule.create).mock.calls[0][0] as never as {
      data: { versions: { create: { amount: number }[] } };
    };
    expect(arg.data.versions.create).toHaveLength(1);
    expect(arg.data.versions.create[0].amount).toBe(15.99);
  });

  it("upserts the budget on the month key", async () => {
    const message = await commitWrite(
      {
        id: "w3",
        summary: "Budget for Groceries",
        fields: [],
        tool: "set_budget",
        payload: { categoryId: "c1", limit: 500, month: "2026-06" },
      },
      "u1",
    );
    expect(prisma.budget.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_categoryId_month: {
            userId: "u1",
            categoryId: "c1",
            month: new Date("2026-06-01T00:00:00.000Z"),
          },
        },
      }),
    );
    expect(message).toContain("2026-06");
  });

  it("refuses a budget on an unowned category", async () => {
    findCategory.mockResolvedValue(null as never);
    await expect(
      commitWrite(
        { id: "w4", summary: "b", fields: [], tool: "set_budget", payload: { categoryId: "cX", limit: 1, month: "2026-06" } },
        "u1",
      ),
    ).rejects.toThrow(/Unknown category/);
    expect(prisma.budget.upsert).not.toHaveBeenCalled();
  });
});

describe("stagedWriteSchema", () => {
  it("rejects a descriptor with an unknown tool", () => {
    expect(stagedWriteSchema.safeParse({ ...txnWrite, tool: "drop_everything" }).success).toBe(false);
  });

  it("rejects a payload the client tampered with", () => {
    expect(
      stagedWriteSchema.safeParse({ ...txnWrite, payload: { ...txnWrite.payload, amount: -1 } }).success,
    ).toBe(false);
  });
});
