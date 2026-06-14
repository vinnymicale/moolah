import { describe, it, expect } from "vitest";
import { aggregateReports, type ReportInput } from "./reports";
import type { AccountDTO, SnapshotDTO } from "./queries";

const account = (over: Partial<AccountDTO>): AccountDTO =>
  ({
    id: "a",
    name: "Acct",
    type: "CHECKING",
    institution: null,
    currentBalance: 0,
    isAsset: true,
    includeInCash: true,
    includeInNetWorth: true,
    includeInDebtPlanner: false,
    color: "#000",
    archived: false,
    interestRate: null,
    minimumPayment: null,
    creditLimit: null,
    lastStatementBalance: null,
    lastStatementDate: null,
    lastPaymentAmount: null,
    lastPaymentDate: null,
    nextPaymentDueDate: null,
    isOverdue: null,
    ...over,
  });

const snap = (accountId: string, date: string, balance: number): SnapshotDTO =>
  ({ id: `${accountId}-${date}`, accountId, date, balance, note: null });

// today is mid-month so "current month" is unambiguous.
const base: ReportInput = {
  todayISO: "2026-06-15",
  accounts: [],
  snapshots: [],
  categories: [],
  txns: [],
  budgets: [],
};

describe("aggregateReports net worth series", () => {
  it("returns twelve months ending on the current month", () => {
    const r = aggregateReports(base);
    expect(r.netWorthSeries).toHaveLength(12);
    expect(r.netWorthSeries.at(-1)?.label).toBe("Jun '26");
    expect(r.netWorthSeries[0].label).toBe("Jul '25");
  });

  it("nets assets positively and liabilities negatively", () => {
    const r = aggregateReports({
      ...base,
      accounts: [
        account({ id: "chk", currentBalance: 1000, isAsset: true }),
        account({ id: "cc", currentBalance: 300, isAsset: false, type: "CREDIT_CARD" }),
      ],
    });
    expect(r.netWorthSeries.at(-1)?.value).toBe(700);
  });

  it("excludes accounts flagged out of net worth", () => {
    const r = aggregateReports({
      ...base,
      accounts: [account({ id: "x", currentBalance: 500, includeInNetWorth: false })],
    });
    expect(r.netWorthSeries.at(-1)?.value).toBe(0);
  });

  it("carries the latest snapshot at or before each month-end forward", () => {
    const r = aggregateReports({
      ...base,
      accounts: [account({ id: "chk", currentBalance: 1000 })],
      snapshots: [snap("chk", "2026-04-30", 400), snap("chk", "2026-06-30", 1000)],
    });
    // April uses its own snapshot; May has none newer so it carries April forward.
    expect(r.netWorthSeries.find((p) => p.label === "Apr '26")?.value).toBe(400);
    expect(r.netWorthSeries.find((p) => p.label === "May '26")?.value).toBe(400);
    expect(r.netWorthSeries.at(-1)?.value).toBe(1000);
  });

  it("falls back to the earliest snapshot for months before any snapshot", () => {
    const r = aggregateReports({
      ...base,
      accounts: [account({ id: "chk", currentBalance: 1000 })],
      snapshots: [snap("chk", "2026-05-31", 800)],
    });
    // A month-end earlier than the earliest snapshot uses that snapshot, not current.
    expect(r.netWorthSeries[0].value).toBe(800);
  });
});

describe("aggregateReports income/expense series", () => {
  it("buckets transactions into the trailing six months", () => {
    const r = aggregateReports({
      ...base,
      txns: [
        { type: "INCOME", amount: 5000, date: "2026-06-01", categoryId: null },
        { type: "EXPENSE", amount: 2000, date: "2026-06-10", categoryId: null },
        { type: "EXPENSE", amount: 100, date: "2026-05-01", categoryId: null },
      ],
    });
    expect(r.incomeExpenseSeries).toHaveLength(6);
    const jun = r.incomeExpenseSeries.at(-1)!;
    expect(jun).toMatchObject({ label: "Jun '26", income: 5000, expense: 2000, net: 3000 });
    const may = r.incomeExpenseSeries.find((p) => p.label === "May '26")!;
    expect(may.expense).toBe(100);
  });
});

describe("aggregateReports category spending", () => {
  it("totals current-month expenses per category, largest first", () => {
    const r = aggregateReports({
      ...base,
      categories: [
        { id: "food", name: "Food", color: "#f00" },
        { id: "gas", name: "Gas", color: "#0f0" },
      ],
      txns: [
        { type: "EXPENSE", amount: 30, date: "2026-06-02", categoryId: "food" },
        { type: "EXPENSE", amount: 70, date: "2026-06-03", categoryId: "food" },
        { type: "EXPENSE", amount: 40, date: "2026-06-04", categoryId: "gas" },
        { type: "INCOME", amount: 999, date: "2026-06-05", categoryId: "food" },
      ],
    });
    expect(r.categorySpending).toEqual([
      { id: "food", name: "Food", color: "#f00", value: 100 },
      { id: "gas", name: "Gas", color: "#0f0", value: 40 },
    ]);
  });

  it("labels missing categories as Uncategorized", () => {
    const r = aggregateReports({
      ...base,
      txns: [{ type: "EXPENSE", amount: 25, date: "2026-06-02", categoryId: null }],
    });
    expect(r.categorySpending).toEqual([{ id: null, name: "Uncategorized", color: "#94a3b8", value: 25 }]);
  });

  it("separates previous-month spending into categoryLastMonth", () => {
    const r = aggregateReports({
      ...base,
      categories: [{ id: "food", name: "Food", color: "#f00" }],
      txns: [{ type: "EXPENSE", amount: 80, date: "2026-05-15", categoryId: "food" }],
    });
    expect(r.categorySpending).toEqual([]);
    expect(r.categoryLastMonth).toEqual([{ id: "food", name: "Food", color: "#f00", value: 80 }]);
  });

  it("attributes a split charge to each split category, not the parent", () => {
    const r = aggregateReports({
      ...base,
      categories: [
        { id: "food", name: "Food", color: "#f00" },
        { id: "home", name: "Home", color: "#0f0" },
      ],
      txns: [
        {
          type: "EXPENSE",
          amount: 100,
          date: "2026-06-02",
          categoryId: null,
          splits: [
            { categoryId: "food", amount: 60 },
            { categoryId: "home", amount: 40 },
          ],
        },
      ],
    });
    expect(r.categorySpending).toEqual([
      { id: "food", name: "Food", color: "#f00", value: 60 },
      { id: "home", name: "Home", color: "#0f0", value: 40 },
    ]);
    // The full amount still counts once toward the month's expense total.
    expect(r.incomeExpenseSeries.at(-1)?.expense).toBe(100);
  });
});

describe("aggregateReports budgets and savings", () => {
  it("pairs budgets with actual current-month spend, largest budget first", () => {
    const r = aggregateReports({
      ...base,
      categories: [
        { id: "food", name: "Food", color: "#f00" },
        { id: "gas", name: "Gas", color: "#0f0" },
      ],
      txns: [{ type: "EXPENSE", amount: 45, date: "2026-06-02", categoryId: "food" }],
      budgets: [
        { categoryId: "gas", limit: 100 },
        { categoryId: "food", limit: 300 },
      ],
    });
    expect(r.budgetVsActual).toEqual([
      { name: "Food", color: "#f00", budget: 300, actual: 45 },
      { name: "Gas", color: "#0f0", budget: 100, actual: 0 },
    ]);
  });

  it("computes savings rate from current-month income and expense", () => {
    const r = aggregateReports({
      ...base,
      txns: [
        { type: "INCOME", amount: 1000, date: "2026-06-01", categoryId: null },
        { type: "EXPENSE", amount: 250, date: "2026-06-02", categoryId: null },
      ],
    });
    expect(r.savingsRate).toBe(75);
  });

  it("returns a null savings rate with no income", () => {
    expect(aggregateReports(base).savingsRate).toBeNull();
  });
});
