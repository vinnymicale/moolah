import { describe, it, expect } from "vitest";
import type { CalendarEvent } from "@/lib/calendar";
import type { AccountType } from "@/generated/prisma/enums";
import { isStatementPayment, compact, computeFilteredTotals } from "./calendar-utils";

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: "e",
  date: "2026-06-10",
  type: "EXPENSE",
  amount: 0,
  description: "x",
  note: null,
  categoryId: null,
  accountId: null,
  cleared: false,
  isVirtual: false,
  isTransfer: false,
  transferPeerType: null,
  recurringRuleId: null,
  plaidTransactionId: null,
  ...over,
});

describe("isStatementPayment", () => {
  it("is true for an expense transfer whose peer is a credit card", () => {
    expect(isStatementPayment({ isTransfer: true, type: "EXPENSE", transferPeerType: "CREDIT_CARD" })).toBe(true);
  });

  it("is false when not a transfer", () => {
    expect(isStatementPayment({ isTransfer: false, type: "EXPENSE", transferPeerType: "CREDIT_CARD" })).toBe(false);
  });

  it("is false for the income (credit) side of the payment", () => {
    expect(isStatementPayment({ isTransfer: true, type: "INCOME", transferPeerType: "CREDIT_CARD" })).toBe(false);
  });

  it("is false for an internal cash-to-cash transfer", () => {
    expect(isStatementPayment({ isTransfer: true, type: "EXPENSE", transferPeerType: "CHECKING" })).toBe(false);
    expect(isStatementPayment({ isTransfer: true, type: "EXPENSE", transferPeerType: null })).toBe(false);
  });
});

describe("compact", () => {
  it("renders sub-$1k amounts whole", () => {
    expect(compact(0)).toBe("$0");
    expect(compact(42)).toBe("$42");
    expect(compact(999)).toBe("$999");
  });

  it("renders thousands with a k suffix, dropping the decimal on round values", () => {
    expect(compact(1000)).toBe("$1k");
    expect(compact(1200)).toBe("$1.2k");
    expect(compact(2500)).toBe("$2.5k");
  });
});

describe("computeFilteredTotals", () => {
  const types = new Map<string, AccountType>([
    ["chk", "CHECKING"],
    ["cc", "CREDIT_CARD"],
  ]);
  const allEnabled = new Set(["chk", "cc"]);
  const base = {
    accountTypeById: types,
    enabledAccountIds: allEnabled,
    showIncome: true,
    showExpense: true,
    monthNum: "2026-06",
    todayISO: "2026-06-10",
  };

  it("splits bank income/expense into actual vs projected for the visible month", () => {
    const res = computeFilteredTotals(
      {
        "2026-06-09": [
          event({ date: "2026-06-09", accountId: "chk", type: "EXPENSE", amount: 100, cleared: true }), // actual
          event({ date: "2026-06-09", accountId: "chk", type: "INCOME", amount: 1000, cleared: true }), // actual
        ],
        "2026-06-10": [event({ date: "2026-06-10", accountId: "chk", type: "EXPENSE", amount: 50, cleared: false })], // pending → projected
        "2026-06-11": [
          event({ date: "2026-06-11", accountId: "chk", type: "EXPENSE", amount: 30, cleared: true, isVirtual: true }), // future recurring
          event({ date: "2026-06-11", accountId: "chk", type: "INCOME", amount: 200, cleared: true }), // future-dated → projected
        ],
      },
      base,
    );
    expect(res.monthExpenseActual).toBe(100);
    expect(res.monthExpense).toBe(180);
    expect(res.monthIncomeActual).toBe(1000);
    expect(res.monthIncome).toBe(1200);
  });

  it("keeps credit-card charges out of bank totals and in their own accrual total", () => {
    const res = computeFilteredTotals(
      {
        "2026-06-09": [
          event({ accountId: "cc", type: "EXPENSE", amount: 75, cleared: true }), // CC charge, actual
          event({ accountId: "cc", type: "EXPENSE", amount: 25, cleared: false }), // CC charge, projected
          event({ accountId: "chk", type: "EXPENSE", amount: 40, cleared: true }), // bank expense
        ],
      },
      base,
    );
    expect(res.monthExpense).toBe(40);
    expect(res.ccCharges).toBe(100);
    expect(res.ccChargesActual).toBe(75);
  });

  it("counts a statement payment as a bank expense but excludes cash-to-cash transfers", () => {
    const res = computeFilteredTotals(
      {
        "2026-06-09": [
          event({ accountId: "chk", type: "EXPENSE", amount: 500, isTransfer: true, transferPeerType: "CREDIT_CARD", cleared: true }), // statement payment
          event({ accountId: "chk", type: "EXPENSE", amount: 300, isTransfer: true, transferPeerType: "SAVINGS", cleared: true }), // internal move
          event({ accountId: "cc", type: "INCOME", amount: 500, isTransfer: true, transferPeerType: "CHECKING", cleared: true }), // CC-credit side
        ],
      },
      base,
    );
    expect(res.monthExpense).toBe(500);
    expect(res.monthExpenseActual).toBe(500);
    expect(res.ccCharges).toBe(0); // the CC-credit side is a transfer, skipped
  });

  it("drops events on accounts that are toggled off, but always keeps them in filteredEventsByDay map per day", () => {
    const res = computeFilteredTotals(
      {
        "2026-06-09": [
          event({ id: "a", accountId: "chk", type: "EXPENSE", amount: 100, cleared: true }),
          event({ id: "b", accountId: "cc", type: "EXPENSE", amount: 50, cleared: true }),
        ],
      },
      { ...base, enabledAccountIds: new Set(["chk"]) },
    );
    expect(res.filteredEventsByDay["2026-06-09"].map((e) => e.id)).toEqual(["a"]);
    expect(res.monthExpense).toBe(100);
    expect(res.ccCharges).toBe(0);
  });

  it("respects the income/expense type toggles", () => {
    const events = {
      "2026-06-09": [
        event({ accountId: "chk", type: "INCOME", amount: 1000, cleared: true }),
        event({ accountId: "chk", type: "EXPENSE", amount: 200, cleared: true }),
      ],
    };
    const incomeOnly = computeFilteredTotals(events, { ...base, showExpense: false });
    expect(incomeOnly.monthIncome).toBe(1000);
    expect(incomeOnly.monthExpense).toBe(0);
    expect(incomeOnly.filteredEventsByDay["2026-06-09"]).toHaveLength(1);

    const expenseOnly = computeFilteredTotals(events, { ...base, showIncome: false });
    expect(expenseOnly.monthIncome).toBe(0);
    expect(expenseOnly.monthExpense).toBe(200);
  });

  it("excludes spillover days from an adjacent month from the totals", () => {
    const res = computeFilteredTotals(
      {
        "2026-05-31": [event({ date: "2026-05-31", accountId: "chk", type: "INCOME", amount: 999, cleared: true })],
        "2026-06-01": [event({ date: "2026-06-01", accountId: "chk", type: "INCOME", amount: 100, cleared: true })],
      },
      base,
    );
    // The May 31 spillover day still appears in the map but not the June totals.
    expect(res.filteredEventsByDay["2026-05-31"]).toHaveLength(1);
    expect(res.monthIncome).toBe(100);
  });
});
