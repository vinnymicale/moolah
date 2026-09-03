// The thin query modules. These are mostly Prisma-row-to-DTO mappers, so the
// things worth pinning down are the parts that aren't mechanical: that every
// query is scoped to the caller's userId, that archived and soft-deleted rows
// stay out by default, and that the net worth split honours includeInNetWorth.

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { findMany: vi.fn() },
    savingsGoal: { findMany: vi.fn() },
    tag: { findMany: vi.fn() },
    rule: { findMany: vi.fn() },
    financialAccount: { findMany: vi.fn(), count: vi.fn() },
    accountSnapshot: { findMany: vi.fn() },
    notification: { findMany: vi.fn(), count: vi.fn() },
    notificationChannel: { findMany: vi.fn() },
    notificationRule: { findMany: vi.fn() },
    plaidItem: { findMany: vi.fn() },
    transaction: { count: vi.fn() },
    budget: { count: vi.fn() },
    recurringRule: { count: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { getCategories } from "./categories";
import { getSavingsGoals } from "./goals";
import { getTags } from "./tags";
import { getRules } from "./rules";
import { getAccounts, getNetWorth, getSnapshots, getOnboardingCounts } from "./accounts";
import {
  getNotifications,
  getUnreadNotificationCount,
  getNotificationChannels,
  getNotificationRules,
} from "./notifications";
import { getPlaidItems } from "./plaid";

// vi.mocked() keeps Prisma's generated delegate signatures, which have no
// mock methods on them. The client here is entirely vi.fn()s, so re-view it as
// one.
type MockedDelegates = Record<string, Record<string, Mock>>;
const db = prisma as unknown as MockedDelegates;

/** Only the account fields the mappers actually read; the rest default to null. */
function account(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "a1", name: "Checking", type: "CHECKING", institution: null,
    currentBalance: 100, isAsset: true, includeInCash: true,
    includeInNetWorth: true, includeInDebtPlanner: false, color: "#111",
    archived: false, interestRate: null, minimumPayment: null, termMonths: null,
    originationDate: null, creditLimit: null, lastStatementBalance: null,
    lastStatementDate: null, lastPaymentAmount: null, lastPaymentDate: null,
    nextPaymentDueDate: null, isOverdue: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCategories", () => {
  it("scopes to the user and orders by kind then name", async () => {
    db.category.findMany.mockResolvedValue([] as never);
    await getCategories("u1");
    const args = db.category.findMany.mock.calls[0][0]!;
    expect(args.where).toEqual({ userId: "u1" });
    expect(args.orderBy).toEqual([{ kind: "asc" }, { name: "asc" }]);
  });

  it("maps a row to its DTO", async () => {
    db.category.findMany.mockResolvedValue([
      { id: "c1", name: "Food", kind: "EXPENSE", color: "#111", icon: "utensils", parentId: null, userId: "u1" },
    ] as never);
    expect(await getCategories("u1")).toEqual([
      { id: "c1", name: "Food", kind: "EXPENSE", color: "#111", icon: "utensils", parentId: null },
    ]);
  });
});

describe("getSavingsGoals", () => {
  beforeEach(() => db.savingsGoal.findMany.mockResolvedValue([] as never));

  it("hides archived goals by default", async () => {
    await getSavingsGoals("u1");
    expect(db.savingsGoal.findMany.mock.calls[0][0]!.where).toEqual({ userId: "u1", archived: false });
  });

  it("includes archived goals when asked", async () => {
    await getSavingsGoals("u1", true);
    expect(db.savingsGoal.findMany.mock.calls[0][0]!.where).toEqual({ userId: "u1" });
  });

  it("renders the target date as an ISO day and leaves a missing one null", async () => {
    db.savingsGoal.findMany.mockResolvedValue([
      { id: "g1", name: "Car", targetAmount: 5000, currentAmount: 1200, targetDate: new Date("2027-03-09T00:00:00.000Z"), color: "#111", icon: "car", archived: false },
      { id: "g2", name: "Rainy day", targetAmount: 1000, currentAmount: 0, targetDate: null, color: "#222", icon: "umbrella", archived: false },
    ] as never);
    const goals = await getSavingsGoals("u1");
    expect(goals[0].targetDate).toBe("2027-03-09");
    expect(goals[0].targetAmount).toBe(5000);
    expect(goals[1].targetDate).toBeNull();
  });
});

describe("getTags", () => {
  it("counts and sums only transactions that aren't soft-deleted", async () => {
    db.tag.findMany.mockResolvedValue([
      { id: "t1", name: "vacation", color: "#111", transactions: [{ amount: 20 }, { amount: 5.5 }] },
      { id: "t2", name: "unused", color: "#222", transactions: [] },
    ] as never);
    const tags = await getTags("u1");
    expect(tags[0]).toEqual({ id: "t1", name: "vacation", color: "#111", usageCount: 2, totalAmount: 25.5 });
    expect(tags[1].usageCount).toBe(0);
    expect(tags[1].totalAmount).toBe(0);

    const args = db.tag.findMany.mock.calls[0][0]!;
    expect(args.where).toEqual({ userId: "u1" });
    expect(args.include!.transactions!.where).toEqual({ deletedAt: null });
  });
});

describe("getRules", () => {
  it("orders by priority and passes conditions and actions through", async () => {
    const conditions = [{ field: "description", op: "contains", value: "coffee" }];
    const actions = [{ type: "setCategory", categoryId: "c1" }];
    db.rule.findMany.mockResolvedValue([
      { id: "r1", name: "Coffee", enabled: true, priority: 1, conditions, actions },
    ] as never);
    const rules = await getRules("u1");
    expect(rules[0].conditions).toEqual(conditions);
    expect(rules[0].actions).toEqual(actions);
    expect(db.rule.findMany.mock.calls[0][0]!.orderBy).toEqual([{ priority: "asc" }, { createdAt: "asc" }]);
  });
});

describe("getAccounts", () => {
  it("hides archived accounts by default and includes them on request", async () => {
    db.financialAccount.findMany.mockResolvedValue([] as never);
    await getAccounts("u1");
    expect(db.financialAccount.findMany.mock.calls[0][0]!.where).toEqual({ userId: "u1", archived: false });
    await getAccounts("u1", true);
    expect(db.financialAccount.findMany.mock.calls[1][0]!.where).toEqual({ userId: "u1" });
  });

  it("converts the optional numeric and date columns without turning null into 0", async () => {
    db.financialAccount.findMany.mockResolvedValue([
      account({
        interestRate: 19.99,
        creditLimit: 5000,
        minimumPayment: null,
        nextPaymentDueDate: new Date("2026-07-01T00:00:00.000Z"),
        lastStatementDate: null,
      }),
    ] as never);
    const [a] = await getAccounts("u1");
    expect(a.interestRate).toBe(19.99);
    expect(a.creditLimit).toBe(5000);
    expect(a.minimumPayment).toBeNull();
    expect(a.nextPaymentDueDate).toBe("2026-07-01");
    expect(a.lastStatementDate).toBeNull();
  });
});

describe("getNetWorth", () => {
  it("splits assets from liabilities and nets them", async () => {
    db.financialAccount.findMany.mockResolvedValue([
      account({ id: "a1", currentBalance: 1000, isAsset: true }),
      account({ id: "a2", currentBalance: 400, isAsset: false }),
    ] as never);
    const nw = await getNetWorth("u1");
    expect(nw).toMatchObject({ assets: 1000, liabilities: 400, net: 600 });
    expect(nw.accounts).toHaveLength(2);
  });

  it("leaves accounts flagged out of net worth out of the totals but still lists them", async () => {
    db.financialAccount.findMany.mockResolvedValue([
      account({ id: "a1", currentBalance: 1000, isAsset: true }),
      account({ id: "a2", currentBalance: 9999, isAsset: true, includeInNetWorth: false }),
    ] as never);
    const nw = await getNetWorth("u1");
    expect(nw.assets).toBe(1000);
    expect(nw.net).toBe(1000);
    expect(nw.accounts).toHaveLength(2);
  });

  it("goes negative when the debts outweigh the assets", async () => {
    db.financialAccount.findMany.mockResolvedValue([
      account({ id: "a1", currentBalance: 100, isAsset: true }),
      account({ id: "a2", currentBalance: 2500, isAsset: false }),
    ] as never);
    expect((await getNetWorth("u1")).net).toBe(-2400);
  });
});

describe("getSnapshots", () => {
  it("reaches ownership through the account relation", async () => {
    db.accountSnapshot.findMany.mockResolvedValue([
      { id: "s1", accountId: "a1", date: new Date("2026-05-31T00:00:00.000Z"), balance: 1234.5, note: null },
    ] as never);
    const snaps = await getSnapshots("u1");
    expect(snaps[0]).toEqual({ id: "s1", accountId: "a1", date: "2026-05-31", balance: 1234.5, note: null });
    expect(db.accountSnapshot.findMany.mock.calls[0][0]!.where).toEqual({ account: { userId: "u1" } });
  });
});

describe("getOnboardingCounts", () => {
  it("counts each thing scoped to the user, skipping soft-deleted transactions", async () => {
    db.financialAccount.count.mockResolvedValue(2 as never);
    db.transaction.count.mockResolvedValue(50 as never);
    db.budget.count.mockResolvedValue(0 as never);
    db.recurringRule.count.mockResolvedValue(3 as never);

    expect(await getOnboardingCounts("u1")).toEqual({
      accountCount: 2, transactionCount: 50, budgetCount: 0, recurringCount: 3,
    });
    expect(db.transaction.count).toHaveBeenCalledWith({ where: { userId: "u1", deletedAt: null } });
    expect(db.financialAccount.count).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });
});

describe("notification queries", () => {
  it("returns the newest notifications first and caps the page", async () => {
    db.notification.findMany.mockResolvedValue([] as never);
    await getNotifications("u1");
    const args = db.notification.findMany.mock.calls[0][0]!;
    expect(args.where).toEqual({ userId: "u1" });
    expect(args.orderBy).toEqual({ firedAt: "desc" });
    expect(args.take).toBe(50);

    await getNotifications("u1", 5);
    expect(db.notification.findMany.mock.calls[1][0]!.take).toBe(5);
  });

  it("serialises timestamps and keeps an unread readAt null", async () => {
    db.notification.findMany.mockResolvedValue([
      { id: "n1", ruleName: "Budget", title: "Over budget", body: "Food", firedAt: new Date("2026-06-01T12:00:00.000Z"), readAt: null, deliveryStatus: "sent", deliveryError: null },
    ] as never);
    const [n] = await getNotifications("u1");
    expect(n.firedAt).toBe("2026-06-01T12:00:00.000Z");
    expect(n.readAt).toBeNull();
  });

  it("counts only unread notifications", async () => {
    db.notification.count.mockResolvedValue(4 as never);
    expect(await getUnreadNotificationCount("u1")).toBe(4);
    expect(db.notification.count).toHaveBeenCalledWith({ where: { userId: "u1", readAt: null } });
  });

  it("scopes channels and rules to the user", async () => {
    db.notificationChannel.findMany.mockResolvedValue([
      { id: "ch1", name: "Discord", kind: "discord", webhookUrl: "https://discord.com/api/webhooks/x" },
    ] as never);
    db.notificationRule.findMany.mockResolvedValue([] as never);

    const [ch] = await getNotificationChannels("u1");
    expect(ch.kind).toBe("discord");
    expect(db.notificationChannel.findMany.mock.calls[0][0]!.where).toEqual({ userId: "u1" });

    await getNotificationRules("u1");
    expect(db.notificationRule.findMany.mock.calls[0][0]!.where).toEqual({ userId: "u1" });
  });
});

describe("getPlaidItems", () => {
  it("nests linked accounts under their item", async () => {
    db.plaidItem.findMany.mockResolvedValue([
      {
        id: "i1", institutionName: "Chase", institutionId: "ins_1",
        lastSyncedAt: new Date("2026-06-01T00:00:00.000Z"), error: null,
        linkedAccounts: [
          { id: "l1", plaidAccountId: "pa1", financialAccountId: "a1", name: "Checking", officialName: null, mask: "1234", plaidType: "depository", plaidSubtype: "checking", availableBalance: 90, currentBalance: 100 },
        ],
      },
    ] as never);
    const [item] = await getPlaidItems("u1");
    expect(item.lastSyncedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(item.linkedAccounts[0]).toMatchObject({ mask: "1234", currentBalance: 100 });
    expect(db.plaidItem.findMany.mock.calls[0][0]!.where).toEqual({ userId: "u1" });
  });

  it("never carries the item's access token into the DTO", async () => {
    db.plaidItem.findMany.mockResolvedValue([
      {
        id: "i1", institutionName: "Chase", institutionId: "ins_1",
        lastSyncedAt: null, error: null,
        accessToken: "access-sandbox-super-secret",
        linkedAccounts: [],
      },
    ] as never);
    const [item] = await getPlaidItems("u1");
    expect(item).not.toHaveProperty("accessToken");
    expect(JSON.stringify(item)).not.toContain("super-secret");
  });

  it("keeps a never-synced item's timestamp null", async () => {
    db.plaidItem.findMany.mockResolvedValue([
      { id: "i1", institutionName: null, institutionId: null, lastSyncedAt: null, error: "ITEM_LOGIN_REQUIRED", linkedAccounts: [] },
    ] as never);
    const [item] = await getPlaidItems("u1");
    expect(item.lastSyncedAt).toBeNull();
    expect(item.error).toBe("ITEM_LOGIN_REQUIRED");
  });
});
