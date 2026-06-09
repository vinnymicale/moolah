import type { BudgetLineDTO, SavingsGoalDTO, TransactionDTO } from "./queries";

export interface DashboardSummaryInput {
  goals: SavingsGoalDTO[];
  monthTxns: TransactionDTO[];
  lastMonthTxns: TransactionDTO[];
  budgetLines: BudgetLineDTO[];
  monthIncome: number;
  monthExpense: number;
  projection: { balance: number }[];
  anchorBalance: number;
}

export interface DashboardSummary {
  topGoals: SavingsGoalDTO[];
  goalsSaved: number;
  goalsTarget: number;
  /** Month-over-month change in expenses, as a percentage, or null if last month had none. */
  spendDeltaPct: number | null;
  net: number;
  /** Share of income kept this month, as a percentage, or null with no income. */
  savingsRate: number | null;
  projectedEnd: number;
  recent: TransactionDTO[];
  /** Categories with a budget set, largest limit first. */
  budgeted: BudgetLineDTO[];
  totalBudget: number;
  budgetSpent: number;
}

const sumExpenses = (txns: TransactionDTO[]) =>
  txns.filter((t) => t.type === "EXPENSE").reduce((sum, t) => sum + t.amount, 0);

/** Derives every figure the dashboard renders from the raw query results. */
export function summarizeDashboard(input: DashboardSummaryInput): DashboardSummary {
  const { goals, monthTxns, lastMonthTxns, budgetLines, monthIncome, monthExpense, projection, anchorBalance } = input;

  const lastMonthExpense = sumExpenses(lastMonthTxns);
  const net = monthIncome - monthExpense;

  const budgeted = budgetLines.filter((b) => b.limit > 0).sort((a, b) => b.limit - a.limit);

  return {
    topGoals: goals.slice(0, 3),
    goalsSaved: goals.reduce((sum, g) => sum + g.currentAmount, 0),
    goalsTarget: goals.reduce((sum, g) => sum + g.targetAmount, 0),
    spendDeltaPct: lastMonthExpense > 0 ? Math.round(((monthExpense - lastMonthExpense) / lastMonthExpense) * 100) : null,
    net,
    savingsRate: monthIncome > 0 ? Math.round((net / monthIncome) * 100) : null,
    projectedEnd: projection.at(-1)?.balance ?? anchorBalance,
    recent: monthTxns.slice(0, 6),
    budgeted,
    totalBudget: budgeted.reduce((sum, b) => sum + b.limit, 0),
    budgetSpent: budgeted.reduce((sum, b) => sum + b.actual, 0),
  };
}
