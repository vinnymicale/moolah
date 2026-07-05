import { prisma } from "@/lib/prisma";
import { fromCents, toCents, toNumber } from "@/lib/money";
import { endOfUTCMonth, parseISODay } from "@/lib/dates";
import { sumPartsByCategory } from "@/lib/splits";
import { rowToSplittable } from "./shared";

export interface BudgetLineDTO {
  categoryId: string;
  name: string;
  color: string;
  icon: string;
  /** Monthly limit, or 0 if no budget is set for this category. */
  limit: number;
  /** Actual expense spending in the month. */
  actual: number;
  /** Whether last month's leftover carries into this month's limit. */
  rollover: boolean;
  /**
   * Last month's leftover (limit - actual, so overspend is negative) when
   * rollover is on and last month had a budget; otherwise 0. Only the
   * immediately preceding month is consulted - carryover does not chain.
   */
  carryover: number;
  /** limit + carryover; what progress and remaining are measured against. */
  effectiveLimit: number;
}

/**
 * Budget vs. actual for every expense category in a given month. `monthISO` is
 * any day in the target month ("YYYY-MM-01" by convention). Categories without
 * a budget come back with limit 0 so the UI can offer to set one.
 */
export async function getBudgetMonth(userId: string, monthISO: string): Promise<BudgetLineDTO[]> {
  const monthStart = parseISODay(`${monthISO.slice(0, 7)}-01`);
  const monthEnd = endOfUTCMonth(monthStart);
  const prevMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 1, 1));
  const prevMonthEnd = endOfUTCMonth(prevMonthStart);

  const txnSelect = { categoryId: true, amount: true, splits: { select: { categoryId: true, amount: true } } } as const;
  const [cats, budgets, txns, prevBudgets, prevTxns] = await Promise.all([
    prisma.category.findMany({ where: { userId, kind: "EXPENSE" }, orderBy: { name: "asc" } }),
    prisma.budget.findMany({ where: { userId, month: monthStart } }),
    prisma.transaction.findMany({
      where: { userId, deletedAt: null, type: "EXPENSE", isTransfer: false, date: { gte: monthStart, lte: monthEnd } },
      select: txnSelect,
    }),
    prisma.budget.findMany({ where: { userId, month: prevMonthStart } }),
    prisma.transaction.findMany({
      where: { userId, deletedAt: null, type: "EXPENSE", isTransfer: false, date: { gte: prevMonthStart, lte: prevMonthEnd } },
      select: txnSelect,
    }),
  ]);

  const budgetByCat = new Map(budgets.map((b) => [b.categoryId, b]));
  const actualByCat = sumPartsByCategory(txns.map(rowToSplittable));
  const prevLimitByCat = new Map(prevBudgets.map((b) => [b.categoryId, toNumber(b.limit)]));
  const prevActualByCat = sumPartsByCategory(prevTxns.map(rowToSplittable));

  return cats.map((c) => {
    const budget = budgetByCat.get(c.id);
    const limit = budget ? toNumber(budget.limit) : 0;
    const rollover = budget?.rollover ?? false;
    const prevLimit = prevLimitByCat.get(c.id) ?? 0;
    const carryover = rollover && prevLimit > 0
      ? fromCents(toCents(prevLimit) - toCents(prevActualByCat.get(c.id) ?? 0))
      : 0;
    return {
      categoryId: c.id,
      name: c.name,
      color: c.color,
      icon: c.icon,
      limit,
      actual: actualByCat.get(c.id) ?? 0,
      rollover,
      carryover,
      effectiveLimit: fromCents(toCents(limit) + toCents(carryover)),
    };
  });
}

export interface BudgetMonthSummaryDTO {
  monthISO: string;
  label: string;
  budget: number;
  actual: number;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Budgeted vs. actual spending for each of the 12 months of `year`. */
export async function getBudgetYear(userId: string, year: number): Promise<BudgetMonthSummaryDTO[]> {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));

  const [budgets, txns] = await Promise.all([
    prisma.budget.findMany({ where: { userId, month: { gte: yearStart, lte: new Date(Date.UTC(year, 11, 1)) } } }),
    prisma.transaction.findMany({
      where: { userId, deletedAt: null, type: "EXPENSE", isTransfer: false, date: { gte: yearStart, lte: yearEnd } },
      select: { date: true, amount: true },
    }),
  ]);

  const budgetByMonth = new Map<number, number>();
  for (const b of budgets) {
    const mi = b.month.getUTCMonth();
    budgetByMonth.set(mi, (budgetByMonth.get(mi) ?? 0) + toNumber(b.limit));
  }
  const actualCentsByMonth = new Map<number, number>();
  for (const t of txns) {
    const mi = t.date.getUTCMonth();
    actualCentsByMonth.set(mi, (actualCentsByMonth.get(mi) ?? 0) + toCents(t.amount));
  }

  return Array.from({ length: 12 }, (_, i) => ({
    monthISO: `${year}-${String(i + 1).padStart(2, "0")}-01`,
    label: MONTHS_SHORT[i],
    budget: budgetByMonth.get(i) ?? 0,
    actual: fromCents(actualCentsByMonth.get(i) ?? 0),
  }));
}
