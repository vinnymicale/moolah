// Tests for the syncPlaidItem/matchTransfers side of plaid-sync.ts (the pure
// helpers are covered in plaid-sync.test.ts). The Plaid client and prisma are
// stubbed; rules, recurrence, and transfer-match run for real, so these
// exercise the actual wiring: sign/type mapping, category resolution,
// automation-rule precedence, pending->posted reconciliation, cursor
// handling, balance/liability refresh, and the recategorize-only mode.

import { describe, it, expect, vi, beforeEach } from "vitest";

const plaidClient = {
  transactionsSync: vi.fn(),
  accountsBalanceGet: vi.fn(),
  liabilitiesGet: vi.fn(),
};
vi.mock("./plaid", () => ({ getPlaidClient: vi.fn(async () => plaidClient) }));

vi.mock("./snapshots", () => ({ captureNetWorthSnapshot: vi.fn() }));

const runRulesMock = vi.fn();
vi.mock("@/lib/notifications/engine", () => ({
  runRules: (...args: unknown[]) => runRulesMock(...args),
}));

vi.mock("./prisma", () => ({
  prisma: {
    plaidItem: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    plaidLinkedAccount: { update: vi.fn() },
    financialAccount: { findMany: vi.fn(), update: vi.fn() },
    category: { findMany: vi.fn() },
    rule: { findMany: vi.fn() },
    tag: { findMany: vi.fn() },
    recurringRule: { findMany: vi.fn() },
    transaction: {
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { syncPlaidItem, matchTransfers } from "./plaid-sync";
import { prisma } from "./prisma";
import { captureNetWorthSnapshot } from "./snapshots";
import { isoDay } from "./dates";

const item = vi.mocked(prisma.plaidItem);
const linkedAccount = vi.mocked(prisma.plaidLinkedAccount);
const account = vi.mocked(prisma.financialAccount);
const category = vi.mocked(prisma.category);
const automationRule = vi.mocked(prisma.rule);
const tag = vi.mocked(prisma.tag);
const recurringRule = vi.mocked(prisma.recurringRule);
const txn = vi.mocked(prisma.transaction);
const snapshot = vi.mocked(captureNetWorthSnapshot);

const baseItem = {
  id: "item1",
  userId: "u1",
  accessToken: "access-token",
  cursor: "cur0",
  linkedAccounts: [
    {
      id: "la1",
      plaidAccountId: "pa1",
      financialAccountId: "fa1",
      financialAccount: { id: "fa1" },
    },
    // Linked at the Plaid level but not bound to a local account yet.
    { id: "la2", plaidAccountId: "pa-unbound", financialAccountId: null, financialAccount: null },
  ],
};

/** A minimal Plaid added/modified transaction. Positive amount = expense. */
const plaidTxn = (over: Record<string, unknown> = {}) => ({
  transaction_id: "ptx1",
  account_id: "pa1",
  amount: 42.5,
  date: "2026-07-10",
  authorized_date: null,
  pending: false,
  pending_transaction_id: null,
  merchant_name: "Wegmans",
  name: "WEGMANS #123",
  personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES" },
  ...over,
});

const syncPage = (over: Record<string, unknown> = {}) => ({
  data: { added: [], modified: [], removed: [], next_cursor: "cur1", has_more: false, ...over },
});

beforeEach(() => {
  vi.clearAllMocks();
  item.findUniqueOrThrow.mockResolvedValue(baseItem as never);
  category.findMany.mockResolvedValue([
    { id: "cat-groceries", name: "Groceries" },
    { id: "cat-dining", name: "Dining Out" },
  ] as never);
  automationRule.findMany.mockResolvedValue([] as never);
  tag.findMany.mockResolvedValue([] as never);
  recurringRule.findMany.mockResolvedValue([] as never);
  txn.upsert.mockResolvedValue({ id: "t-new" } as never);
  txn.findMany.mockResolvedValue([] as never);
  txn.findUnique.mockResolvedValue({ tags: [] } as never);
  account.findMany.mockResolvedValue([] as never);
  plaidClient.transactionsSync.mockResolvedValue(syncPage());
  plaidClient.accountsBalanceGet.mockResolvedValue({ data: { accounts: [] } });
  plaidClient.liabilitiesGet.mockResolvedValue({ data: { liabilities: { credit: [] } } });
  runRulesMock.mockResolvedValue({ failed: 0 });
});

describe("syncPlaidItem - added transactions", () => {
  it("creates an expense with the Plaid category mapped to a local category", async () => {
    plaidClient.transactionsSync.mockResolvedValue(syncPage({ added: [plaidTxn()] }));

    const result = await syncPlaidItem("item1", "u1");

    expect(result.added).toBe(1);
    const args = txn.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ plaidTransactionId: "ptx1" });
    expect(args.create).toMatchObject({
      userId: "u1",
      accountId: "fa1",
      type: "EXPENSE",
      amount: 42.5,
      description: "Wegmans",
      categoryId: "cat-groceries",
      isTransfer: false,
      cleared: true,
      plaidPrimaryCategory: "FOOD_AND_DRINK",
      plaidDetailedCategory: "FOOD_AND_DRINK_GROCERIES",
    });
    expect(isoDay(args.create.date as Date)).toBe("2026-07-10");
  });

  it("scopes the item lookup to the calling user", async () => {
    await syncPlaidItem("item1", "u1");
    expect(item.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "item1", userId: "u1" } }),
    );
  });

  it("maps a negative Plaid amount to INCOME with the absolute value", async () => {
    plaidClient.transactionsSync.mockResolvedValue(
      syncPage({ added: [plaidTxn({ amount: -1500, personal_finance_category: null })] }),
    );

    await syncPlaidItem("item1", "u1");

    expect(txn.upsert.mock.calls[0][0].create).toMatchObject({
      type: "INCOME",
      amount: 1500,
      categoryId: null,
    });
  });

  it("skips transactions on Plaid accounts not bound to a local account", async () => {
    plaidClient.transactionsSync.mockResolvedValue(
      syncPage({ added: [plaidTxn({ account_id: "pa-unbound" }), plaidTxn({ account_id: "pa-unknown" })] }),
    );

    const result = await syncPlaidItem("item1", "u1");

    expect(result.added).toBe(0);
    expect(txn.upsert).not.toHaveBeenCalled();
  });

  it("prefers authorized_date over the posting date", async () => {
    plaidClient.transactionsSync.mockResolvedValue(
      syncPage({ added: [plaidTxn({ authorized_date: "2026-07-08" })] }),
    );

    await syncPlaidItem("item1", "u1");

    expect(isoDay(txn.upsert.mock.calls[0][0].create.date as Date)).toBe("2026-07-08");
  });

  it("marks a pending charge as not cleared", async () => {
    plaidClient.transactionsSync.mockResolvedValue(
      syncPage({ added: [plaidTxn({ pending: true })] }),
    );

    await syncPlaidItem("item1", "u1");

    expect(txn.upsert.mock.calls[0][0].create.cleared).toBe(false);
  });

  it("lets automation rules beat Plaid's category and rewrite the description", async () => {
    automationRule.findMany.mockResolvedValue([
      {
        id: "ar1",
        priority: 1,
        enabled: true,
        conditions: [{ type: "descriptionContains", value: "wegmans" }],
        actions: [
          { type: "rewriteDescription", to: "Wegmans (cleaned)" },
          { type: "setCategory", categoryId: "cat-dining" },
          { type: "markTransfer" },
        ],
      },
    ] as never);
    plaidClient.transactionsSync.mockResolvedValue(syncPage({ added: [plaidTxn()] }));

    await syncPlaidItem("item1", "u1");

    expect(txn.upsert.mock.calls[0][0].create).toMatchObject({
      description: "Wegmans (cleaned)",
      categoryId: "cat-dining",
      isTransfer: true,
    });
  });

  it("deletes the superseded pending row when a settled version arrives", async () => {
    plaidClient.transactionsSync.mockResolvedValue(
      syncPage({ added: [plaidTxn({ pending_transaction_id: "pend-1" })] }),
    );

    await syncPlaidItem("item1", "u1");

    expect(txn.deleteMany).toHaveBeenCalledWith({
      where: { plaidTransactionId: "pend-1", userId: "u1" },
    });
  });

  it("connects tags added by a matching automation rule to a live tag", async () => {
    automationRule.findMany.mockResolvedValue([
      {
        id: "ar1",
        priority: 1,
        enabled: true,
        conditions: [{ type: "descriptionContains", value: "wegmans" }],
        actions: [{ type: "addTag", tagId: "tag-groceries" }],
      },
    ] as never);
    tag.findMany.mockResolvedValue([{ id: "tag-groceries" }] as never);
    plaidClient.transactionsSync.mockResolvedValue(syncPage({ added: [plaidTxn()] }));

    await syncPlaidItem("item1", "u1");

    expect(txn.update).toHaveBeenCalledWith({
      where: { id: "t-new" },
      data: { tags: { connect: [{ id: "tag-groceries" }] } },
    });
  });

  it("does not connect a tag the rule references once it has been deleted", async () => {
    automationRule.findMany.mockResolvedValue([
      {
        id: "ar1",
        priority: 1,
        enabled: true,
        conditions: [{ type: "descriptionContains", value: "wegmans" }],
        actions: [{ type: "addTag", tagId: "tag-deleted" }],
      },
    ] as never);
    tag.findMany.mockResolvedValue([] as never); // tag-deleted is no longer live
    plaidClient.transactionsSync.mockResolvedValue(syncPage({ added: [plaidTxn()] }));

    await syncPlaidItem("item1", "u1");

    expect(txn.update).not.toHaveBeenCalled();
  });
});

describe("syncPlaidItem - modified and removed", () => {
  it("updates a modified transaction scoped to the user", async () => {
    plaidClient.transactionsSync.mockResolvedValue(
      syncPage({ modified: [plaidTxn({ amount: 55 })] }),
    );

    const result = await syncPlaidItem("item1", "u1");

    expect(result.modified).toBe(1);
    expect(txn.updateMany).toHaveBeenCalledWith({
      where: { plaidTransactionId: "ptx1", userId: "u1" },
      data: expect.objectContaining({ amount: 55, type: "EXPENSE", categoryId: "cat-groceries" }),
    });
  });

  it("deletes removed transactions scoped to the user", async () => {
    plaidClient.transactionsSync.mockResolvedValue(
      syncPage({ removed: [{ transaction_id: "ptx-gone" }] }),
    );

    const result = await syncPlaidItem("item1", "u1");

    expect(result.removed).toBe(1);
    expect(txn.deleteMany).toHaveBeenCalledWith({
      where: { plaidTransactionId: "ptx-gone", userId: "u1" },
    });
  });

  it("connects tags added by a matching automation rule on a modified transaction", async () => {
    automationRule.findMany.mockResolvedValue([
      {
        id: "ar1",
        priority: 1,
        enabled: true,
        conditions: [{ type: "descriptionContains", value: "wegmans" }],
        actions: [{ type: "addTag", tagId: "tag-groceries" }],
      },
    ] as never);
    tag.findMany.mockResolvedValue([{ id: "tag-groceries" }] as never);
    txn.findFirst.mockResolvedValue({ id: "t-mod", tags: [] } as never);
    plaidClient.transactionsSync.mockResolvedValue(syncPage({ modified: [plaidTxn()] }));

    await syncPlaidItem("item1", "u1");

    expect(txn.update).toHaveBeenCalledWith({
      where: { id: "t-mod" },
      data: { tags: { connect: [{ id: "tag-groceries" }] } },
    });
  });
});

describe("syncPlaidItem - pagination and cursor", () => {
  it("follows has_more pages, threading the cursor, and persists the final one", async () => {
    plaidClient.transactionsSync
      .mockResolvedValueOnce(syncPage({ has_more: true, next_cursor: "cur1" }))
      .mockResolvedValueOnce(syncPage({ has_more: false, next_cursor: "cur2" }));

    await syncPlaidItem("item1", "u1");

    expect(plaidClient.transactionsSync).toHaveBeenCalledTimes(2);
    expect(plaidClient.transactionsSync.mock.calls[0][0].cursor).toBe("cur0");
    expect(plaidClient.transactionsSync.mock.calls[1][0].cursor).toBe("cur1");
    expect(item.update).toHaveBeenCalledWith({
      where: { id: "item1" },
      data: expect.objectContaining({ cursor: "cur2", error: null, failureCount: 0 }),
    });
  });

  it("notifies the engine with the ids of newly synced transactions", async () => {
    plaidClient.transactionsSync.mockResolvedValue(syncPage({ added: [plaidTxn()] }));

    await syncPlaidItem("item1", "u1");

    expect(runRulesMock).toHaveBeenCalledWith("u1", {
      mode: "event",
      event: { kind: "plaid-sync", plaidItemId: "item1", newTransactionIds: ["t-new"] },
    });
  });

  it("survives snapshot and notification failures", async () => {
    snapshot.mockRejectedValue(new Error("snapshot boom"));
    runRulesMock.mockRejectedValue(new Error("notify boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(syncPlaidItem("item1", "u1")).resolves.toMatchObject({ added: 0 });
    expect(item.update).toHaveBeenCalled(); // cursor still persisted

    errSpy.mockRestore();
  });
});

describe("syncPlaidItem - balances and liabilities", () => {
  it("updates linked-account and local balances", async () => {
    plaidClient.accountsBalanceGet.mockResolvedValue({
      data: {
        accounts: [
          { account_id: "pa1", balances: { current: 500.25, available: 400, limit: 5000 } },
          { account_id: "pa-unknown", balances: { current: 1, available: 1, limit: null } },
        ],
      },
    });

    const result = await syncPlaidItem("item1", "u1");

    expect(result.balancesUpdated).toBe(1);
    expect(linkedAccount.update).toHaveBeenCalledTimes(1);
    expect(linkedAccount.update).toHaveBeenCalledWith({
      where: { id: "la1" },
      data: { currentBalance: 500.25, availableBalance: 400, creditLimit: 5000 },
    });
    expect(account.update).toHaveBeenCalledWith({
      where: { id: "fa1" },
      data: { currentBalance: 500.25, creditLimit: 5000 },
    });
  });

  it("skips the local-account update when Plaid reports no current balance", async () => {
    plaidClient.accountsBalanceGet.mockResolvedValue({
      data: { accounts: [{ account_id: "pa1", balances: { current: null, available: null, limit: null } }] },
    });

    const result = await syncPlaidItem("item1", "u1");

    expect(result.balancesUpdated).toBe(0);
    expect(linkedAccount.update).toHaveBeenCalledTimes(1);
    expect(account.update).not.toHaveBeenCalled();
  });

  it("stores credit-card statement fields from liabilities", async () => {
    plaidClient.liabilitiesGet.mockResolvedValue({
      data: {
        liabilities: {
          credit: [
            {
              account_id: "pa1",
              last_statement_balance: 250,
              last_statement_issue_date: "2026-07-01",
              last_payment_amount: 100,
              last_payment_date: "2026-06-25",
              minimum_payment_amount: 35,
              next_payment_due_date: "2026-07-25",
              is_overdue: false,
            },
          ],
        },
      },
    });

    await syncPlaidItem("item1", "u1");

    const call = account.update.mock.calls.find((c) => c[0].data.lastStatementBalance !== undefined);
    expect(call).toBeDefined();
    expect(call![0]).toMatchObject({
      where: { id: "fa1" },
      data: expect.objectContaining({
        lastStatementBalance: 250,
        minimumPayment: 35,
        isOverdue: false,
      }),
    });
    expect(call![0].data.nextPaymentDueDate).toEqual(new Date("2026-07-25T00:00:00Z"));
  });

  it("treats a liabilities failure as non-fatal", async () => {
    plaidClient.liabilitiesGet.mockRejectedValue(new Error("PRODUCT_NOT_READY"));
    await expect(syncPlaidItem("item1", "u1")).resolves.toBeDefined();
  });
});

describe("syncPlaidItem - recategorizeOnly", () => {
  beforeEach(() => {
    txn.findUnique.mockResolvedValue(null as never);
    txn.findFirst.mockResolvedValue(null as never);
  });

  it("re-pulls from the start of history and never advances the real cursor", async () => {
    await syncPlaidItem("item1", "u1", { recategorizeOnly: true });

    expect(plaidClient.transactionsSync.mock.calls[0][0].cursor).toBeUndefined();
    expect(item.update).not.toHaveBeenCalled();
    expect(runRulesMock).not.toHaveBeenCalled();
  });

  it("adopts an existing twin row instead of duplicating after a cursor reset", async () => {
    plaidClient.transactionsSync.mockResolvedValue(syncPage({ added: [plaidTxn()] }));
    txn.findFirst.mockResolvedValue({ id: "twin1" } as never);

    await syncPlaidItem("item1", "u1", { recategorizeOnly: true });

    expect(txn.update).toHaveBeenCalledWith({
      where: { id: "twin1" },
      data: { plaidTransactionId: "ptx1" },
    });
  });

  it("does not overwrite user-set categories, only fills empty ones", async () => {
    plaidClient.transactionsSync.mockResolvedValue(syncPage({ added: [plaidTxn()] }));

    await syncPlaidItem("item1", "u1", { recategorizeOnly: true });

    // The upsert's update branch must not touch categoryId or isTransfer...
    const upsertUpdate = txn.upsert.mock.calls[0][0].update;
    expect(upsertUpdate.categoryId).toBeUndefined();
    expect(upsertUpdate.isTransfer).toBeUndefined();
    // ...the fill-in goes through a guarded updateMany instead.
    expect(txn.updateMany).toHaveBeenCalledWith({
      where: { plaidTransactionId: "ptx1", categoryId: null },
      data: { categoryId: "cat-groceries" },
    });
  });
});

describe("matchTransfers", () => {
  const today = isoDay(new Date());

  it("pairs a CC payment credit with the bank expense that funded it", async () => {
    account.findMany.mockResolvedValue([
      { id: "fa-checking", type: "CHECKING" },
      { id: "fa-cc", type: "CREDIT_CARD" },
    ] as never);
    txn.findMany.mockResolvedValue([
      { id: "tx-exp", type: "EXPENSE", amount: 250, date: new Date(`${today}T00:00:00Z`), accountId: "fa-checking", isTransfer: false, transferPeerId: null },
      { id: "tx-inc", type: "INCOME", amount: 250, date: new Date(`${today}T00:00:00Z`), accountId: "fa-cc", isTransfer: false, transferPeerId: null },
    ] as never);

    const count = await matchTransfers("u1");

    expect(count).toBe(1);
    expect(txn.update).toHaveBeenCalledWith({
      where: { id: "tx-exp" },
      data: { isTransfer: true, transferPeerId: "tx-inc" },
    });
    expect(txn.update).toHaveBeenCalledWith({
      where: { id: "tx-inc" },
      data: { isTransfer: true },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("pairs nothing when amounts differ", async () => {
    account.findMany.mockResolvedValue([
      { id: "fa-checking", type: "CHECKING" },
      { id: "fa-cc", type: "CREDIT_CARD" },
    ] as never);
    txn.findMany.mockResolvedValue([
      { id: "tx-exp", type: "EXPENSE", amount: 250, date: new Date(`${today}T00:00:00Z`), accountId: "fa-checking", isTransfer: false, transferPeerId: null },
      { id: "tx-inc", type: "INCOME", amount: 99, date: new Date(`${today}T00:00:00Z`), accountId: "fa-cc", isTransfer: false, transferPeerId: null },
    ] as never);

    const count = await matchTransfers("u1");

    expect(count).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
