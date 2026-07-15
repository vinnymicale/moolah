// Action-layer tests for rules.ts. These cover the demo-mode short-circuit,
// schema validation, the assertReferencesOwned guard (a rule must not smuggle
// in another user's category/account ids via its JSON payload), priority
// assignment on create, the reorder integrity check, and the apply
// orchestration. The rule engine itself (evaluateRules/splitByRatio) and
// transfer matching are mocked - they have their own unit tests.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));

vi.mock("@/lib/rules", () => ({
  evaluateRules: vi.fn(() => ({})),
  splitByRatio: vi.fn(() => []),
}));
vi.mock("@/lib/plaid-sync", () => ({ matchTransfers: vi.fn(async () => 0) }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    rule: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
    },
    category: { count: vi.fn() },
    financialAccount: { count: vi.fn() },
    tag: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    transaction: { findMany: vi.fn(), update: vi.fn() },
    transactionSplit: { createMany: vi.fn() },
    $transaction: vi.fn(async (ops) => (Array.isArray(ops) ? Promise.all(ops) : ops)),
  },
}));

import {
  createRuleAction,
  updateRuleAction,
  setRuleEnabledAction,
  reorderRulesAction,
  applyRulesAction,
} from "./rules";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { evaluateRules, splitByRatio } from "@/lib/rules";
import { matchTransfers } from "@/lib/plaid-sync";

const requireUserMock = vi.mocked(requireUser);
const rule = vi.mocked(prisma.rule);
const category = vi.mocked(prisma.category);
const account = vi.mocked(prisma.financialAccount);
const tag = vi.mocked(prisma.tag);
const txn = vi.mocked(prisma.transaction);
const evaluateRulesMock = vi.mocked(evaluateRules);
const splitByRatioMock = vi.mocked(splitByRatio);

const setCategoryRule = {
  conditions: [{ type: "descriptionContains" as const, value: "costco" }],
  actions: [{ type: "setCategory" as const, categoryId: "cat1" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  requireUserMock.mockResolvedValue({ userId: "u1" } as Awaited<ReturnType<typeof requireUser>>);
  evaluateRulesMock.mockReturnValue({});
});

describe("demo-mode guard", () => {
  beforeEach(() => {
    demoMode.value = true;
  });

  it("createRuleAction is a no-op success in demo mode", async () => {
    expect(await createRuleAction(setCategoryRule)).toEqual({ ok: true });
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(rule.create).not.toHaveBeenCalled();
  });

  it("applyRulesAction returns zero counts in demo mode", async () => {
    expect(await applyRulesAction()).toEqual({
      ok: true,
      categorized: 0,
      renamed: 0,
      transfersMarked: 0,
      split: 0,
      tagged: 0,
    });
    expect(txn.findMany).not.toHaveBeenCalled();
  });
});

describe("createRuleAction validation", () => {
  it("rejects a rule with no conditions", async () => {
    const result = await createRuleAction({ conditions: [], actions: setCategoryRule.actions });
    expect(result).toEqual({ ok: false, error: "Add at least one condition" });
    expect(rule.create).not.toHaveBeenCalled();
  });

  it("rejects a rule with no actions", async () => {
    const result = await createRuleAction({ conditions: setCategoryRule.conditions, actions: [] });
    expect(result).toEqual({ ok: false, error: "Add at least one action" });
  });

  it("rejects a split action with fewer than two parts", async () => {
    const result = await createRuleAction({
      conditions: setCategoryRule.conditions,
      actions: [{ type: "split", parts: [{ categoryId: "c1", ratio: 1 }] }],
    });
    expect(result).toEqual({ ok: false, error: "A split needs at least two parts" });
  });
});

describe("createRuleAction ownership guard", () => {
  it("rejects a category id the user does not own", async () => {
    category.count.mockResolvedValue(0); // referenced 1, found 0
    const result = await createRuleAction(setCategoryRule);
    expect(result).toEqual({ ok: false, error: "Category not found" });
    expect(rule.create).not.toHaveBeenCalled();
  });

  it("rejects an account id the user does not own", async () => {
    category.count.mockResolvedValue(1);
    account.count.mockResolvedValue(0);
    const result = await createRuleAction({
      conditions: [{ type: "account", accountId: "acc1" }],
      actions: setCategoryRule.actions,
    });
    expect(result).toEqual({ ok: false, error: "Account not found" });
  });

  it("assigns the next priority above the current highest", async () => {
    category.count.mockResolvedValue(1);
    rule.findFirst.mockResolvedValue({ priority: 4 } as never);
    const result = await createRuleAction(setCategoryRule);
    expect(result).toEqual({ ok: true });
    expect(rule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ priority: 5, enabled: true }),
    });
  });

  it("starts priority at 0 for the first rule", async () => {
    category.count.mockResolvedValue(1);
    rule.findFirst.mockResolvedValue(null);
    await createRuleAction(setCategoryRule);
    expect(rule.create.mock.calls[0][0].data.priority).toBe(0);
  });
});

describe("updateRuleAction", () => {
  it("errors when the rule does not belong to the user", async () => {
    category.count.mockResolvedValue(1);
    rule.findFirst.mockResolvedValue(null);
    const result = await updateRuleAction("r1", setCategoryRule);
    expect(result).toEqual({ ok: false, error: "Rule not found" });
    expect(rule.update).not.toHaveBeenCalled();
  });
});

describe("setRuleEnabledAction", () => {
  it("errors when no owned rule matched", async () => {
    rule.updateMany.mockResolvedValue({ count: 0 } as never);
    const result = await setRuleEnabledAction("r1", false);
    expect(result).toEqual({ ok: false, error: "Rule not found" });
  });

  it("toggles an owned rule", async () => {
    rule.updateMany.mockResolvedValue({ count: 1 } as never);
    const result = await setRuleEnabledAction("r1", false);
    expect(result).toEqual({ ok: true });
    expect(rule.updateMany).toHaveBeenCalledWith({ where: { id: "r1", userId: "u1" }, data: { enabled: false } });
  });
});

describe("reorderRulesAction", () => {
  it("rejects an order that omits a rule", async () => {
    rule.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }] as never);
    const result = await reorderRulesAction(["a"]);
    expect(result).toEqual({ ok: false, error: "Reorder must include every rule exactly once." });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an order referencing an unknown rule", async () => {
    rule.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }] as never);
    const result = await reorderRulesAction(["a", "zzz"]);
    expect(result).toEqual({ ok: false, error: "Reorder must include every rule exactly once." });
  });

  it("writes priorities matching the supplied order", async () => {
    rule.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }] as never);
    const result = await reorderRulesAction(["b", "a"]);
    expect(result).toEqual({ ok: true });
    expect(rule.update).toHaveBeenNthCalledWith(1, { where: { id: "b" }, data: { priority: 0 } });
    expect(rule.update).toHaveBeenNthCalledWith(2, { where: { id: "a" }, data: { priority: 1 } });
  });
});

describe("applyRulesAction", () => {
  it("returns zero counts when the user has no rules", async () => {
    rule.findMany.mockResolvedValue([]);
    const result = await applyRulesAction();
    expect(result).toEqual({ ok: true, categorized: 0, renamed: 0, transfersMarked: 0, split: 0, tagged: 0 });
    expect(txn.findMany).not.toHaveBeenCalled();
  });

  it("fills an empty category but never clobbers a hand-set one", async () => {
    rule.findMany.mockResolvedValue([{ id: "r1", priority: 0, enabled: true, conditions: [], actions: [] }] as never);
    txn.findMany.mockResolvedValue([
      { id: "t1", description: "Costco", amount: "50", accountId: "a1", type: "EXPENSE", categoryId: null, isTransfer: false, splits: [], tags: [] },
      { id: "t2", description: "Costco", amount: "50", accountId: "a1", type: "EXPENSE", categoryId: "manual", isTransfer: false, splits: [], tags: [] },
    ] as never);
    evaluateRulesMock.mockReturnValue({ categoryId: "cat1" });

    const result = await applyRulesAction();
    expect(result).toMatchObject({ ok: true, categorized: 1 });
    // Only the uncategorized t1 is written.
    expect(txn.update).toHaveBeenCalledTimes(1);
    expect(txn.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { categoryId: "cat1" } });
  });

  it("marks transfers and runs the pairing pass when any were marked", async () => {
    rule.findMany.mockResolvedValue([{ id: "r1", priority: 0, enabled: true, conditions: [], actions: [] }] as never);
    txn.findMany.mockResolvedValue([
      { id: "t1", description: "Payment", amount: "100", accountId: "a1", type: "EXPENSE", categoryId: null, isTransfer: false, splits: [], tags: [] },
    ] as never);
    evaluateRulesMock.mockReturnValue({ markTransfer: true });

    const result = await applyRulesAction();
    expect(result).toMatchObject({ ok: true, transfersMarked: 1 });
    expect(txn.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { isTransfer: true } });
    expect(matchTransfers).toHaveBeenCalledWith("u1");
  });

  it("does not run the pairing pass when nothing was marked", async () => {
    rule.findMany.mockResolvedValue([{ id: "r1", priority: 0, enabled: true, conditions: [], actions: [] }] as never);
    txn.findMany.mockResolvedValue([
      { id: "t1", description: "Costco", amount: "50", accountId: "a1", type: "EXPENSE", categoryId: null, isTransfer: false, splits: [], tags: [] },
    ] as never);
    evaluateRulesMock.mockReturnValue({ categoryId: "cat1" });

    await applyRulesAction();
    expect(matchTransfers).not.toHaveBeenCalled();
  });

  it("connects new tags from addTagIds, skipping already-connected and deleted ones", async () => {
    rule.findMany.mockResolvedValue([{ id: "r1", priority: 0, enabled: true, conditions: [], actions: [] }] as never);
    txn.findMany.mockResolvedValue([
      {
        id: "t1",
        description: "Costco",
        amount: "50",
        accountId: "a1",
        type: "EXPENSE",
        categoryId: "cat1",
        isTransfer: false,
        splits: [],
        tags: [{ id: "tag-existing" }],
      },
    ] as never);
    tag.findMany.mockResolvedValue([{ id: "tag-existing" }, { id: "tag-new" }] as never);
    evaluateRulesMock.mockReturnValue({ addTagIds: ["tag-existing", "tag-new", "tag-deleted"] });

    const result = await applyRulesAction();
    expect(result).toMatchObject({ ok: true, tagged: 1 });
    expect(txn.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { tags: { connect: [{ id: "tag-new" }] } },
    });
  });

  it("connects tags on a split transaction without double-counting", async () => {
    rule.findMany.mockResolvedValue([{ id: "r1", priority: 0, enabled: true, conditions: [], actions: [] }] as never);
    txn.findMany.mockResolvedValue([
      {
        id: "t1",
        description: "Costco",
        amount: "50",
        accountId: "a1",
        type: "EXPENSE",
        categoryId: "cat1",
        isTransfer: false,
        splits: [],
        tags: [],
      },
    ] as never);
    tag.findMany.mockResolvedValue([{ id: "tag-new" }] as never);
    evaluateRulesMock.mockReturnValue({
      splits: [{ categoryId: "cat1", ratio: 1 }],
      addTagIds: ["tag-new"],
    });
    splitByRatioMock.mockReturnValue([{ categoryId: "cat1", amountCents: 5000 }]);

    const result = await applyRulesAction();
    expect(result).toMatchObject({ ok: true, split: 1, tagged: 1 });
    expect(txn.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { tags: { connect: [{ id: "tag-new" }] } },
    });
  });
});
