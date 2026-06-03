// Aggregations for the Trends page. Returns plain arrays ready for Recharts.

import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/money";
import {
  addUTCMonths, endOfUTCMonth, isoDay, parseISODay, startOfUTCMonth,
} from "@/lib/dates";
import { getAccounts, getSnapshots } from "@/lib/queries";

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

export async function computeReports(householdId: string, todayISO: string): Promise<Reports> {
  const today = parseISODay(todayISO);
  const monthStart = startOfUTCMonth(today);

  const [accounts, snapshots, categories] = await Promise.all([
    getAccounts(householdId),
    getSnapshots(householdId),
    prisma.category.findMany({ where: { householdId } }),
  ]);
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
  const sixMonthsAgo = startOfUTCMonth(addUTCMonths(monthStart, -5));
  const txns = await prisma.transaction.findMany({
    where: { householdId, date: { gte: sixMonthsAgo, lte: endOfUTCMonth(monthStart) } },
    select: { type: true, amount: true, date: true, categoryId: true },
  });

  const ieByMonth = new Map<string, IncomeExpensePoint>();
  for (let i = 5; i >= 0; i--) {
    const m = addUTCMonths(monthStart, -i);
    ieByMonth.set(isoDay(m).slice(0, 7), { label: monthShort(m), income: 0, expense: 0, net: 0 });
  }
  for (const t of txns) {
    const key = isoDay(t.date).slice(0, 7);
    const row = ieByMonth.get(key);
    if (!row) continue;
    const amt = toNumber(t.amount);
    if (t.type === "INCOME") row.income += amt;
    else row.expense += amt;
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
    const key = isoDay(t.date).slice(0, 7);
    const amt = toNumber(t.amount);
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
  const budgets = await prisma.budget.findMany({ where: { householdId, month: monthStart } });
  const budgetVsActual: BudgetRow[] = budgets
    .map((b) => {
      const cat = catById.get(b.categoryId);
      return {
        name: cat?.name ?? "—",
        color: cat?.color ?? "#94a3b8",
        budget: toNumber(b.limit),
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
