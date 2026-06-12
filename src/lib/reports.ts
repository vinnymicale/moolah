// Aggregations for the Trends page. Returns plain arrays ready for Recharts.

import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/money";
import {
  addUTCMonths, endOfUTCMonth, isoDay, parseISODay, startOfUTCMonth,
} from "@/lib/dates";
import { getAccounts, getSnapshots, type AccountDTO, type SnapshotDTO } from "@/lib/queries";

export interface NetWorthPoint { label: string; value: number; }
export interface IncomeExpensePoint { label: string; income: number; expense: number; net: number; }
export interface CategorySlice { id: string | null; name: string; value: number; color: string; }
export interface BudgetRow { name: string; color: string; budget: number; actual: number; }

export interface Reports {
  netWorthSeries: NetWorthPoint[];
  incomeExpenseSeries: IncomeExpensePoint[];
  categorySpending: CategorySlice[];
  /** Same shape as categorySpending but for the previous calendar month. */
  categoryLastMonth: CategorySlice[];
  budgetVsActual: BudgetRow[];
  currentMonthLabel: string;
  savingsRate: number | null;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthShort = (d: Date) => `${MONTHS_SHORT[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`;

/** A transaction reduced to the fields the reports need. */
export interface ReportTxn {
  type: "INCOME" | "EXPENSE";
  amount: number;
  date: string; // ISO day
  categoryId: string | null;
}

/** A budget reduced to the fields the reports need. */
export interface ReportBudget {
  categoryId: string;
  limit: number;
}

export interface ReportInput {
  todayISO: string;
  accounts: AccountDTO[];
  snapshots: SnapshotDTO[];
  categories: { id: string; name: string; color: string }[];
  /** Concrete, non-transfer transactions in the trailing six-month window. */
  txns: ReportTxn[];
  /** Budgets for the current month. */
  budgets: ReportBudget[];
}

export async function computeReports(userId: string, todayISO: string): Promise<Reports> {
  const today = parseISODay(todayISO);
  const monthStart = startOfUTCMonth(today);
  const sixMonthsAgo = startOfUTCMonth(addUTCMonths(monthStart, -5));

  const [accounts, snapshots, categories, txnRows, budgetRows] = await Promise.all([
    getAccounts(userId),
    getSnapshots(userId),
    prisma.category.findMany({ where: { userId } }),
    prisma.transaction.findMany({
      where: { userId, isTransfer: false, date: { gte: sixMonthsAgo, lte: endOfUTCMonth(monthStart) } },
      select: { type: true, amount: true, date: true, categoryId: true },
    }),
    prisma.budget.findMany({ where: { userId, month: monthStart } }),
  ]);

  return aggregateReports({
    todayISO,
    accounts,
    snapshots,
    categories,
    txns: txnRows.map((t) => ({ type: t.type, amount: toNumber(t.amount), date: isoDay(t.date), categoryId: t.categoryId })),
    budgets: budgetRows.map((b) => ({ categoryId: b.categoryId, limit: toNumber(b.limit) })),
  });
}

/** Pure aggregation over already-fetched data. Drives the Trends page. */
export function aggregateReports({ todayISO, accounts, snapshots, categories, txns, budgets }: ReportInput): Reports {
  const today = parseISODay(todayISO);
  const monthStart = startOfUTCMonth(today);

  const catById = new Map(categories.map((c) => [c.id, c]));

  // ── Net worth over the last 12 months ────────────────────────────────────
  const snapsByAccount = new Map<string, { date: string; balance: number }[]>();
  for (const s of snapshots) {
    (snapsByAccount.get(s.accountId) ?? snapsByAccount.set(s.accountId, []).get(s.accountId)!).push(s);
  }
  const balanceAt = (accountId: string, current: number, monthEnd: Date): number => {
    const snaps = snapsByAccount.get(accountId);
    if (!snaps || snaps.length === 0) return current;
    let val = current;
    let found = false;
    for (const s of snaps) {
      if (parseISODay(s.date).getTime() <= monthEnd.getTime()) {
        val = s.balance;
        found = true;
      }
    }
    // If the earliest snapshot is after this month-end, fall back to it so the
    // historical line doesn't jump to the present-day balance.
    return found ? val : snaps[0].balance;
  };

  const netWorthSeries: NetWorthPoint[] = [];
  for (let i = 11; i >= 0; i--) {
    const me = endOfUTCMonth(addUTCMonths(monthStart, -i));
    let net = 0;
    for (const a of accounts) {
      if (!a.includeInNetWorth) continue;
      const bal = balanceAt(a.id, a.currentBalance, me);
      net += a.isAsset ? bal : -bal;
    }
    netWorthSeries.push({ label: monthShort(me), value: Math.round(net * 100) / 100 });
  }

  // ── Income vs expense, last 6 months (concrete transactions) ─────────────
  const ieByMonth = new Map<string, IncomeExpensePoint>();
  for (let i = 5; i >= 0; i--) {
    const m = addUTCMonths(monthStart, -i);
    ieByMonth.set(isoDay(m).slice(0, 7), { label: monthShort(m), income: 0, expense: 0, net: 0 });
  }
  for (const t of txns) {
    const key = t.date.slice(0, 7);
    const row = ieByMonth.get(key);
    if (!row) continue;
    if (t.type === "INCOME") row.income += t.amount;
    else row.expense += t.amount;
  }
  const incomeExpenseSeries = Array.from(ieByMonth.values()).map((r) => ({
    ...r,
    income: round(r.income),
    expense: round(r.expense),
    net: round(r.income - r.expense),
  }));

  // ── Spending by category, current and previous month ─────────────────────
  const catTotals = new Map<string, number>();
  const catTotalsLastMonth = new Map<string, number>();
  let monthIncome = 0;
  let monthExpense = 0;
  const currentMonthKey = isoDay(monthStart).slice(0, 7);
  const lastMonthKey = isoDay(addUTCMonths(monthStart, -1)).slice(0, 7);

  for (const t of txns) {
    const key = t.date.slice(0, 7);
    const amt = t.amount;
    if (key === currentMonthKey) {
      if (t.type === "INCOME") { monthIncome += amt; continue; }
      monthExpense += amt;
      const catKey = t.categoryId ?? "uncategorized";
      catTotals.set(catKey, (catTotals.get(catKey) ?? 0) + amt);
    } else if (key === lastMonthKey && t.type === "EXPENSE") {
      const catKey = t.categoryId ?? "uncategorized";
      catTotalsLastMonth.set(catKey, (catTotalsLastMonth.get(catKey) ?? 0) + amt);
    }
  }

  const sliceFrom = (totals: Map<string, number>): CategorySlice[] =>
    Array.from(totals.entries())
      .map(([id, value]) => ({
        id: id === "uncategorized" ? null : id,
        name: id === "uncategorized" ? "Uncategorized" : catById.get(id)?.name ?? "Uncategorized",
        color: id === "uncategorized" ? "#94a3b8" : catById.get(id)?.color ?? "#94a3b8",
        value: round(value),
      }))
      .sort((a, b) => b.value - a.value);

  const categorySpending = sliceFrom(catTotals);
  const categoryLastMonth = sliceFrom(catTotalsLastMonth);

  // ── Budget vs actual, current month ──────────────────────────────────────
  const budgetVsActual: BudgetRow[] = budgets
    .map((b) => {
      const cat = catById.get(b.categoryId);
      return {
        name: cat?.name ?? "-",
        color: cat?.color ?? "#94a3b8",
        budget: b.limit,
        actual: round(catTotals.get(b.categoryId) ?? 0),
      };
    })
    .sort((a, b) => b.budget - a.budget);

  const savingsRate = monthIncome > 0 ? Math.round(((monthIncome - monthExpense) / monthIncome) * 100) : null;

  return {
    netWorthSeries,
    incomeExpenseSeries,
    categorySpending,
    categoryLastMonth,
    budgetVsActual,
    currentMonthLabel: today.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    savingsRate,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
