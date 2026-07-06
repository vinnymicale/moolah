// Suggested-budget computation.
//
// Combines the user's saved recurring rules with recurring charges detected
// from transaction history (see recurring-suggestions.ts) and rolls them up
// into a suggested monthly budget per expense category. When a target month
// is given, yearly charges land in their renewal month instead of being
// smoothed, and detected charges that stopped recurring are flagged stale.
// Pure and synchronous; the server layer loads rules/transactions and feeds
// them in.

import { toCents, fromCents } from "./money";
import type { RecurringSuggestion } from "./recurring-suggestions";

export type BudgetFrequency = "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "YEARLY";

export interface RuleForBudget {
  id: string;
  description: string;
  amount: number;
  type: "INCOME" | "EXPENSE";
  categoryId: string | null;
  frequency: BudgetFrequency;
  interval: number;
  /** Anchor date (YYYY-MM-DD); places yearly renewals in their month. */
  startDate?: string;
}

/** The subset of a detected RecurringSuggestion the budget rollup needs. */
export type DetectedForBudget = Pick<
  RecurringSuggestion,
  "key" | "description" | "amount" | "type" | "frequency" | "interval" | "categoryId" | "cadence" | "startDate"
>;

/** A merchant/description that contributed to a category's variable spend. */
export interface VariableExpenseSample {
  description: string;
  /** Total spent on this description across the window. */
  total: number;
  count: number;
}

/** Per-category totals of recent monthly spend, for variable-spend suggestions. */
export interface VariableSpend {
  categoryId: string;
  /** Total expense spend for each of the last N months (any order). */
  monthlyTotals: number[];
  /** Largest non-recurring expenses in the window, biggest first. */
  topExpenses?: VariableExpenseSample[];
}

export interface ChargeItem {
  /** Rule id, the detector's group key, or "variable:<categoryId>". */
  id: string;
  description: string;
  source: "rule" | "detected" | "typical";
  /** Human cadence label, e.g. "monthly" or "about weekly". */
  cadence: string;
  /** The charge normalized to a per-month amount. */
  monthlyAmount: number;
  /** Detected charge that hasn't recurred on schedule; excluded from totals. */
  stale?: boolean;
  /** For "typical" items: the expenses behind the median, biggest first. */
  topExpenses?: VariableExpenseSample[];
}

export interface CategorySuggestion {
  categoryId: string;
  /** Sum of non-stale item monthly amounts, rounded up to a whole dollar. */
  suggested: number;
  items: ChargeItem[];
}

export interface BudgetSuggestions {
  categories: CategorySuggestion[];
  /** Expense charges skipped because they have no category. */
  uncategorized: ChargeItem[];
}

/** A category suggestion joined with display info and the month's current limit. */
export interface SuggestedCategoryDTO extends CategorySuggestion {
  name: string;
  color: string;
  icon: string;
  /** Existing limit for the month, or 0 if none. */
  currentLimit: number;
  /** Total spend for each of the 6 months before the target, oldest first. */
  recentTotals: number[];
}

export interface BudgetSuggestionsDTO {
  categories: SuggestedCategoryDTO[];
  /** Recurring expense charges skipped because they have no category. */
  uncategorizedCount: number;
}

// Average periods per month for each frequency.
const PER_MONTH: Record<BudgetFrequency, number> = {
  DAILY: 365 / 12,
  WEEKLY: 52 / 12,
  BIWEEKLY: 26 / 12,
  MONTHLY: 1,
  YEARLY: 1 / 12,
};

/** Normalize an amount at a given cadence to dollars per month (cents-safe). */
export function monthlyAmount(amount: number, frequency: BudgetFrequency, interval: number): number {
  const per = PER_MONTH[frequency] / Math.max(1, interval);
  return fromCents(Math.round(toCents(amount) * per));
}

const FREQ_NOUN: Record<BudgetFrequency, [single: string, unit: string]> = {
  DAILY: ["daily", "days"],
  WEEKLY: ["weekly", "weeks"],
  BIWEEKLY: ["every 2 weeks", "x2 weeks"],
  MONTHLY: ["monthly", "months"],
  YEARLY: ["yearly", "years"],
};

/** "monthly", "weekly", "every 3 months", ... */
function ruleCadenceLabel(frequency: BudgetFrequency, interval: number): string {
  const [single, unit] = FREQ_NOUN[frequency];
  if (interval <= 1) return single;
  if (frequency === "BIWEEKLY") return `every ${interval * 2} weeks`;
  return `every ${interval} ${unit}`;
}

// Expected days between occurrences, for staleness checks.
const GAP_DAYS: Record<BudgetFrequency, number> = {
  DAILY: 1,
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 30.44,
  YEARLY: 365.25,
};

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function daysBetweenISO(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 1-based month number from "YYYY-MM-DD". */
function isoMonth(iso: string): number {
  return Number(iso.slice(5, 7));
}

/**
 * A detected charge is stale when the target month starts well past its next
 * expected occurrence (1.75x the cadence gap since it was last seen).
 */
function isStale(lastSeen: string, monthISO: string, frequency: BudgetFrequency, interval: number): boolean {
  const expectedGap = GAP_DAYS[frequency] * Math.max(1, interval);
  return daysBetweenISO(lastSeen, monthISO) > expectedGap * 1.75;
}

/**
 * Amount and label for a yearly charge relative to the target month: full
 * amount when the renewal anniversary lands in that month, zero otherwise.
 */
function yearlyForMonth(
  amount: number,
  anchor: string,
  monthISO: string,
  baseLabel: string,
): { monthlyAmount: number; cadence: string } {
  if (isoMonth(anchor) === isoMonth(monthISO)) {
    return { monthlyAmount: amount, cadence: `${baseLabel} · due this month` };
  }
  return { monthlyAmount: 0, cadence: `${baseLabel} · next due ${MONTH_SHORT[isoMonth(anchor) - 1]}` };
}

function medianCents(totals: number[]): number {
  const sorted = totals.map(toCents).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function buildBudgetSuggestions({
  rules,
  detected,
  monthISO,
  variableSpend = [],
}: {
  rules: RuleForBudget[];
  detected: DetectedForBudget[];
  /** Target month ("YYYY-MM-01"). Enables staleness and yearly placement. */
  monthISO?: string;
  variableSpend?: VariableSpend[];
}): BudgetSuggestions {
  const byCategory = new Map<string, ChargeItem[]>();
  const uncategorized: ChargeItem[] = [];

  const add = (categoryId: string | null, item: ChargeItem) => {
    if (!categoryId) {
      uncategorized.push(item);
      return;
    }
    (byCategory.get(categoryId) ?? byCategory.set(categoryId, []).get(categoryId)!).push(item);
  };

  for (const r of rules) {
    if (r.type !== "EXPENSE") continue;
    const cadence = ruleCadenceLabel(r.frequency, r.interval);
    const placed =
      monthISO && r.frequency === "YEARLY" && r.startDate
        ? yearlyForMonth(r.amount, r.startDate, monthISO, cadence)
        : { monthlyAmount: monthlyAmount(r.amount, r.frequency, r.interval), cadence };
    add(r.categoryId, { id: r.id, description: r.description, source: "rule", ...placed });
  }

  for (const d of detected) {
    if (d.type !== "EXPENSE") continue;
    const stale = monthISO ? isStale(d.startDate, monthISO, d.frequency, d.interval) : false;
    // For a detected yearly charge the last occurrence is the anniversary.
    const placed =
      monthISO && d.frequency === "YEARLY" && !stale
        ? yearlyForMonth(d.amount, d.startDate, monthISO, d.cadence)
        : { monthlyAmount: monthlyAmount(d.amount, d.frequency, d.interval), cadence: d.cadence };
    add(d.categoryId, {
      id: d.key,
      description: d.description,
      source: "detected",
      ...placed,
      ...(stale ? { stale } : {}),
    });
  }

  // Typical variable spending: the median month's spend beyond what recurring
  // charges already cover. Needs at least 3 months with activity for signal.
  for (const v of variableSpend) {
    if (v.monthlyTotals.filter((t) => t > 0).length < 3) continue;
    const recurringCents = (byCategory.get(v.categoryId) ?? []).reduce(
      (s, i) => (i.stale ? s : s + toCents(i.monthlyAmount)),
      0,
    );
    const residual = medianCents(v.monthlyTotals) - recurringCents;
    if (residual < 100) continue; // under a dollar isn't worth suggesting
    add(v.categoryId, {
      id: `variable:${v.categoryId}`,
      description: "Typical variable spending",
      source: "typical",
      cadence: "median of recent months",
      monthlyAmount: fromCents(residual),
      ...(v.topExpenses?.length ? { topExpenses: v.topExpenses } : {}),
    });
  }

  const categories: CategorySuggestion[] = [...byCategory.entries()].map(([categoryId, items]) => {
    const totalCents = items.reduce((s, i) => (i.stale ? s : s + toCents(i.monthlyAmount)), 0);
    return {
      categoryId,
      suggested: Math.ceil(totalCents / 100),
      items: items.sort((a, b) => b.monthlyAmount - a.monthlyAmount),
    };
  });

  return {
    categories: categories.sort((a, b) => b.suggested - a.suggested),
    uncategorized,
  };
}
