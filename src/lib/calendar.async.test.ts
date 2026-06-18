import { describe, it, expect, beforeEach, vi } from "vitest";
import { getUpcoming, getCalendarMonth } from "./calendar";
import { prisma } from "@/lib/prisma";
import { getAccounts } from "@/lib/queries";
import type { AccountDTO } from "@/lib/queries";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: vi.fn() },
    recurringRule: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/queries", () => ({
  getAccounts: vi.fn(),
}));

const txnFind = vi.mocked(prisma.transaction.findMany);
const ruleFind = vi.mocked(prisma.recurringRule.findMany);
const acctGet = vi.mocked(getAccounts);

const account = (over: Partial<AccountDTO>): AccountDTO =>
  ({
    id: "checking",
    name: "Checking",
    type: "CHECKING",
    currentBalance: 0,
    includeInCash: true,
    isAsset: true,
    color: "#000",
    icon: "bank",
    minimumPayment: null,
    lastStatementBalance: null,
    nextPaymentDueDate: null,
    isOverdue: null,
    archived: false,
    ...over,
  }) as AccountDTO;

// A recurring rule row as Prisma would return it (Date fields, Decimal amount).
const rule = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  userId: "u1",
  description: "Rent",
  amount: 1500,
  type: "EXPENSE",
  frequency: "MONTHLY",
  interval: 1,
  startDate: new Date("2026-01-01T00:00:00Z"),
  endDate: null,
  dayOfMonth: 1,
  weekday: null,
  categoryId: "housing",
  note: null,
  accountId: "checking",
  archived: false,
  ...over,
});

const txn = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  userId: "u1",
  description: "Coffee",
  amount: 5,
  type: "EXPENSE",
  date: new Date("2026-06-10T00:00:00Z"),
  cleared: true,
  isTransfer: false,
  accountId: "checking",
  categoryId: "food",
  note: null,
  recurringRuleId: null,
  plaidTransactionId: null,
  transferPeer: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  acctGet.mockResolvedValue([account({})]);
  txnFind.mockResolvedValue([] as never);
  ruleFind.mockResolvedValue([] as never);
});

describe("getUpcoming", () => {
  it("includes pending one-off transactions in the window", async () => {
    txnFind
      .mockResolvedValueOnce([txn({ cleared: false, date: new Date("2026-06-20T00:00:00Z") })] as never)
      .mockResolvedValueOnce([] as never); // materialised links
    const items = await getUpcoming("u1", "2026-06-15", 14);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ date: "2026-06-20", description: "Coffee", amount: 5, recurring: false });
  });

  it("skips pending transactions that are effective transfers", async () => {
    txnFind
      .mockResolvedValueOnce([
        txn({ id: "real", cleared: false, date: new Date("2026-06-18T00:00:00Z") }),
        txn({ id: "xfer", cleared: false, isTransfer: true, date: new Date("2026-06-19T00:00:00Z") }),
      ] as never)
      .mockResolvedValueOnce([] as never);
    const items = await getUpcoming("u1", "2026-06-15", 14);
    expect(items.map((i) => i.description)).toEqual(["Coffee"]);
  });

  it("skips a CC-income transfer leg and CC-bound recurring rules", async () => {
    acctGet.mockResolvedValue([account({ id: "card", type: "CREDIT_CARD", includeInCash: false })]);
    txnFind
      .mockResolvedValueOnce([
        // Unpaired INCOME on a credit card = payment credit, not real income.
        txn({ id: "ccpay", type: "INCOME", cleared: false, accountId: "card", date: new Date("2026-06-18T00:00:00Z") }),
      ] as never)
      .mockResolvedValueOnce([] as never);
    ruleFind.mockResolvedValue([rule({ type: "INCOME", accountId: "card" })] as never);
    const items = await getUpcoming("u1", "2026-06-15", 14);
    expect(items).toEqual([]);
  });

  it("projects recurring occurrences but suppresses ones already materialised", async () => {
    txnFind
      .mockResolvedValueOnce([] as never) // no pending one-offs
      .mockResolvedValueOnce([
        { recurringRuleId: "r1", date: new Date("2026-07-01T00:00:00Z") },
      ] as never); // July rent already posted
    ruleFind.mockResolvedValue([rule({ dayOfMonth: 1 })] as never);
    // Window spanning July 1 so the rule would otherwise produce an occurrence.
    const items = await getUpcoming("u1", "2026-06-25", 14);
    expect(items.filter((i) => i.recurring)).toEqual([]);
  });

  it("sorts the combined list by date ascending", async () => {
    txnFind
      .mockResolvedValueOnce([
        txn({ id: "late", description: "Late", cleared: false, date: new Date("2026-06-28T00:00:00Z") }),
      ] as never)
      .mockResolvedValueOnce([] as never);
    ruleFind.mockResolvedValue([rule({ dayOfMonth: 20, description: "Rent" })] as never);
    const items = await getUpcoming("u1", "2026-06-15", 20);
    expect(items.map((i) => i.description)).toEqual(["Rent", "Late"]);
  });
});

describe("getCalendarMonth", () => {
  it("assembles concrete events and an anchor balance from cash accounts", async () => {
    acctGet.mockResolvedValue([
      account({ id: "checking", currentBalance: 1000, includeInCash: true }),
      account({ id: "savings", currentBalance: 500, includeInCash: true }),
      account({ id: "card", type: "CREDIT_CARD", currentBalance: -200, includeInCash: false }),
    ]);
    txnFind.mockResolvedValue([txn({ date: new Date("2026-06-10T00:00:00Z"), amount: 25 })] as never);
    const month = await getCalendarMonth("u1", "2026-06-01", "2026-06-15");
    expect(month.anchorBalance).toBe(1500); // CC excluded from cash
    expect(month.eventsByDay["2026-06-10"]).toHaveLength(1);
    expect(month.monthExpense).toBe(25);
  });

  it("marks an unpaired CC income as an effective transfer, out of income totals", async () => {
    acctGet.mockResolvedValue([account({ id: "card", type: "CREDIT_CARD", includeInCash: false })]);
    txnFind.mockResolvedValue([
      txn({ id: "ccpay", type: "INCOME", amount: 300, accountId: "card", date: new Date("2026-06-10T00:00:00Z") }),
    ] as never);
    const month = await getCalendarMonth("u1", "2026-06-01", "2026-06-15");
    expect(month.eventsByDay["2026-06-10"][0].isTransfer).toBe(true);
    expect(month.monthIncome).toBe(0);
  });

  it("emits virtual occurrences for recurring rules and suppresses near a real one", async () => {
    txnFind.mockResolvedValue([
      // Real rent landed June 2, within the 4-day window of the June 1 occurrence.
      txn({ id: "rent-real", type: "EXPENSE", amount: 1500, recurringRuleId: "r1", date: new Date("2026-06-02T00:00:00Z") }),
    ] as never);
    ruleFind.mockResolvedValue([rule({ dayOfMonth: 1 })] as never);
    const month = await getCalendarMonth("u1", "2026-06-01", "2026-06-15");
    const all = Object.values(month.eventsByDay).flat();
    const virtuals = all.filter((e) => e.isVirtual);
    // June occurrence suppressed (materialised June 2); only later months' virtuals, if any, survive.
    expect(virtuals.every((e) => e.date >= "2026-06-30" || !e.date.startsWith("2026-06"))).toBe(true);
    expect(all.some((e) => e.id === "rent-real")).toBe(true);
  });

  it("shows a CC payment-due chip on its due day within the grid", async () => {
    acctGet.mockResolvedValue([
      account({
        id: "card",
        type: "CREDIT_CARD",
        includeInCash: false,
        nextPaymentDueDate: "2026-06-20",
        lastStatementBalance: 400,
        minimumPayment: 35,
        isOverdue: false,
      }),
    ]);
    const month = await getCalendarMonth("u1", "2026-06-01", "2026-06-15");
    expect(month.ccDueByDay["2026-06-20"]).toBeDefined();
    expect(month.ccDueByDay["2026-06-20"][0]).toMatchObject({ statementBalance: 400, minimumPayment: 35 });
  });

  it("hides a past CC due chip that is not flagged overdue", async () => {
    acctGet.mockResolvedValue([
      account({ id: "card", type: "CREDIT_CARD", includeInCash: false, nextPaymentDueDate: "2026-06-05", isOverdue: false }),
    ]);
    const month = await getCalendarMonth("u1", "2026-06-01", "2026-06-15");
    expect(month.ccDueByDay["2026-06-05"]).toBeUndefined();
  });
});
