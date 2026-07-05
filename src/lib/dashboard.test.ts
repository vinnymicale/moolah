import { describe, it, expect } from "vitest";
import { summarizeDashboard, type DashboardSummaryInput } from "./dashboard";
import type { BudgetLineDTO, SavingsGoalDTO, TransactionDTO } from "./queries";

const txn = (type: "INCOME" | "EXPENSE", amount: number): TransactionDTO =>
  ({ type, amount } as TransactionDTO);

const goal = (currentAmount: number, targetAmount: number): SavingsGoalDTO =>
  ({ currentAmount, targetAmount } as SavingsGoalDTO);

const budget = (limit: number, actual: number): BudgetLineDTO =>
  ({ categoryId: "c", name: "n", color: "#000", icon: "tag", limit, actual, rollover: false, carryover: 0, effectiveLimit: limit });

const base: DashboardSummaryInput = {
  goals: [],
  monthTxns: [],
  lastMonthTxns: [],
  budgetLines: [],
  monthIncome: 0,
  monthExpense: 0,
  projection: [],
  anchorBalance: 0,
};

describe("summarizeDashboard", () => {
  it("computes net and savings rate from income and expense", () => {
    const s = summarizeDashboard({ ...base, monthIncome: 1000, monthExpense: 750 });
    expect(s.net).toBe(250);
    expect(s.savingsRate).toBe(25);
  });

  it("returns a null savings rate when there is no income", () => {
    expect(summarizeDashboard({ ...base, monthIncome: 0, monthExpense: 50 }).savingsRate).toBeNull();
  });

  it("computes the month-over-month spend delta against last month's expenses", () => {
    const s = summarizeDashboard({
      ...base,
      monthExpense: 120,
      lastMonthTxns: [txn("EXPENSE", 100), txn("INCOME", 999)],
    });
    expect(s.spendDeltaPct).toBe(20);
  });

  it("returns a null spend delta when last month had no expenses", () => {
    expect(summarizeDashboard({ ...base, monthExpense: 50 }).spendDeltaPct).toBeNull();
  });

  it("excludes effective transfers from last month's expense base", () => {
    // A CC payment credit posts as INCOME and is marked effectiveTransfer; an
    // expense leg that's an explicit transfer is likewise excluded. Only the
    // real $100 expense should anchor the delta.
    const ccCredit = { type: "INCOME", amount: 500, effectiveTransfer: true } as TransactionDTO;
    const transferLeg = { type: "EXPENSE", amount: 500, effectiveTransfer: true } as TransactionDTO;
    const s = summarizeDashboard({
      ...base,
      monthExpense: 120,
      lastMonthTxns: [txn("EXPENSE", 100), ccCredit, transferLeg],
    });
    expect(s.spendDeltaPct).toBe(20);
  });

  it("keeps only budgeted categories, ordered by largest limit, with totals", () => {
    const s = summarizeDashboard({
      ...base,
      budgetLines: [budget(0, 5), budget(100, 40), budget(300, 90)],
    });
    expect(s.budgeted.map((b) => b.limit)).toEqual([300, 100]);
    expect(s.totalBudget).toBe(400);
    expect(s.budgetSpent).toBe(130);
  });

  it("uses the projection's last balance as the projected end, falling back to the anchor", () => {
    expect(summarizeDashboard({ ...base, anchorBalance: 42 }).projectedEnd).toBe(42);
    expect(
      summarizeDashboard({ ...base, anchorBalance: 42, projection: [{ balance: 10 }, { balance: 5 }] }).projectedEnd,
    ).toBe(5);
  });

  it("takes the top three goals and totals saved vs. target", () => {
    const s = summarizeDashboard({
      ...base,
      goals: [goal(10, 100), goal(20, 200), goal(30, 300), goal(40, 400)],
    });
    expect(s.topGoals).toHaveLength(3);
    expect(s.goalsSaved).toBe(100);
    expect(s.goalsTarget).toBe(1000);
  });
});
