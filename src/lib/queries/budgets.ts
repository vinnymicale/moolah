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
   * Leftover carried in from prior months (negative when those months were
   * overspent). Carryover chains: a month with rollover on passes along its own
   * leftover plus whatever it inherited, so an underspend three months back
   * still shows up here. The chain stops at the first month going backwards
   * that has no budget or has rollover off - that month starts fresh.
   */
  carryover: number;
  /** limit + carryover; what progress and remaining are measured against. */
  effectiveLimit: number;
}

// How far back the carryover chain is allowed to walk. A budget the user has
// kept rolling for years shouldn't make the budgets page scan all of history,
// and two years of unspent grocery money is not a number anyone is tracking.
const MAX_ROLLOVER_MONTHS = 24;

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

/**
 * Budget vs. actual for every expense category in a given month. `monthISO` is
 * any day in the target month ("YYYY-MM-01" by convention). Categories without
 * a budget come back with limit 0 so the UI can offer to set one.
 */
export async function getBudgetMonth(userId: string, monthISO: string): Promise<BudgetLineDTO[]> {
  const monthStart = parseISODay(`${monthISO.slice(0, 7)}-01`);
  const monthEnd = endOfUTCMonth(monthStart);
  // The chain can only reach back through months that exist in the window, so
  // fetch the whole window up front rather than querying one month at a time.
  const windowStart = addMonths(monthStart, -MAX_ROLLOVER_MONTHS);
  const prevMonthEnd = endOfUTCMonth(addMonths(monthStart, -1));

  const txnSelect = { categoryId: true, amount: true, splits: { select: { categoryId: true, amount: true } } } as const;
  const [cats, budgets, txns, priorBudgets, priorTxns] = await Promise.all([
    prisma.category.findMany({ where: { userId, kind: "EXPENSE" }, orderBy: { name: "asc" } }),
    prisma.budget.findMany({ where: { userId, month: monthStart } }),
    prisma.transaction.findMany({
      where: { userId, deletedAt: null, type: "EXPENSE", isTransfer: false, date: { gte: monthStart, lte: monthEnd } },
      select: txnSelect,
    }),
    prisma.budget.findMany({ where: { userId, month: { gte: windowStart, lt: monthStart } } }),
    prisma.transaction.findMany({
      where: { userId, deletedAt: null, type: "EXPENSE", isTransfer: false, date: { gte: windowStart, lte: prevMonthEnd } },
      select: { ...txnSelect, date: true },
    }),
  ]);

  const budgetByCat = new Map(budgets.map((b) => [b.categoryId, b]));
  const actualByCat = sumPartsByCategory(txns.map(rowToSplittable));

  // Prior months keyed by their ISO month, so the fold can step month by month.
  const priorByMonth = new Map<string, Map<string, { limit: number; rollover: boolean }>>();
  for (const b of priorBudgets) {
    const key = monthKey(b.month);
    let byCat = priorByMonth.get(key);
    if (!byCat) priorByMonth.set(key, (byCat = new Map()));
    byCat.set(b.categoryId, { limit: toNumber(b.limit), rollover: b.rollover });
  }
  const priorSpendByMonth = new Map<string, Map<string, number>>();
  const txnsByMonth = new Map<string, typeof priorTxns>();
  for (const t of priorTxns) {
    const key = monthKey(t.date);
    const rows = txnsByMonth.get(key);
    if (rows) rows.push(t);
    else txnsByMonth.set(key, [t]);
  }
  for (const [key, rows] of txnsByMonth) {
    priorSpendByMonth.set(key, sumPartsByCategory(rows.map(rowToSplittable)));
  }

  return cats.map((c) => {
    const budget = budgetByCat.get(c.id);
    const limit = budget ? toNumber(budget.limit) : 0;
    const rollover = budget?.rollover ?? false;
    const carryover = rollover ? carryoverFor(c.id, monthStart, priorByMonth, priorSpendByMonth) : 0;
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

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Walk back from `monthStart` to the oldest month still in the chain, then fold
 * forward accumulating each month's leftover. Walking back first is what makes
 * chaining work: a month's leftover depends on what it inherited, which is only
 * known once its own predecessors have been resolved.
 */
function carryoverFor(
  categoryId: string,
  monthStart: Date,
  budgetsByMonth: Map<string, Map<string, { limit: number; rollover: boolean }>>,
  spendByMonth: Map<string, Map<string, number>>,
): number {
  const chain: string[] = [];
  for (let back = 1; back <= MAX_ROLLOVER_MONTHS; back += 1) {
    const key = monthKey(addMonths(monthStart, -back));
    const budget = budgetsByMonth.get(key)?.get(categoryId);
    if (!budget || budget.limit <= 0) break;
    chain.push(key);
    // This month didn't roll anything in, so it's where the chain starts.
    if (!budget.rollover) break;
  }

  let cents = 0;
  for (const key of chain.reverse()) {
    const budget = budgetsByMonth.get(key)!.get(categoryId)!;
    const spent = spendByMonth.get(key)?.get(categoryId) ?? 0;
    cents += toCents(budget.limit) - toCents(spent);
  }
  return fromCents(cents);
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
