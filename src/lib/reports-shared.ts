// Pure, client-safe pieces of the reports module: types and helpers with no
// Prisma (or other server-only) imports, so client components like the Trends
// charts can pull them in without dragging the DB layer into the browser
// bundle. reports.ts re-exports everything here for server callers.

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
  /** Current-month income broken down by category, for the cash-flow diagram. */
  incomeByCategory: CategorySlice[];
  budgetVsActual: BudgetRow[];
  currentMonthLabel: string;
  savingsRate: number | null;
}

/** Neutral swatch for the rolled-up "Other" slice. Slate-400. */
export const OTHER_SLICE_COLOR = "#94a3b8";

/**
 * Collapse a (descending-by-value) list of category slices to at most `max`
 * named slices plus a single rolled-up "Other" slice. Keeps the pie readable
 * and its legend in sync with the chart. Input is assumed sorted desc; slices
 * are summed regardless. Returns a new array; never mutates the input.
 */
export function capCategorySlices(slices: CategorySlice[], max = 5): CategorySlice[] {
  if (slices.length <= max) return slices.slice();
  const head = slices.slice(0, max);
  const rest = slices.slice(max);
  const otherValue = rest.reduce((s, x) => s + x.value, 0);
  if (otherValue <= 0) return head;
  return [
    ...head,
    { id: null, name: `Other (${rest.length})`, value: otherValue, color: OTHER_SLICE_COLOR },
  ];
}

/**
 * Three-state budget status from spend vs. limit:
 *  - "under": comfortably within budget
 *  - "near":  at/over the warn threshold (default 90%) but not over
 *  - "over":  spent more than the limit
 * A zero/negative limit is treated as "under" (nothing to exceed).
 */
export type BudgetStatus = "under" | "near" | "over";

export function budgetStatus(actual: number, limit: number, warnAt = 0.9): BudgetStatus {
  if (limit <= 0) return "under";
  if (actual > limit) return "over";
  if (actual >= limit * warnAt) return "near";
  return "under";
}
