// Suggested-budget computation.
//
// Combines the user's saved recurring rules with recurring charges detected
// from transaction history (see recurring-suggestions.ts) and rolls them up
// into a suggested monthly budget per expense category. Pure and synchronous;
// the server layer loads rules/transactions and feeds them in.

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
}

/** The subset of a detected RecurringSuggestion the budget rollup needs. */
export type DetectedForBudget = Pick<
  RecurringSuggestion,
  "key" | "description" | "amount" | "type" | "frequency" | "interval" | "categoryId" | "cadence"
>;

export interface ChargeItem {
  /** Rule id, or the detector's group key. */
  id: string;
  description: string;
  source: "rule" | "detected";
  /** Human cadence label, e.g. "monthly" or "about weekly". */
  cadence: string;
  /** The charge normalized to a per-month amount. */
  monthlyAmount: number;
}

export interface CategorySuggestion {
  categoryId: string;
  /** Sum of item monthly amounts, rounded up to a whole dollar. */
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

export function buildBudgetSuggestions({
  rules,
  detected,
}: {
  rules: RuleForBudget[];
  detected: DetectedForBudget[];
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
    add(r.categoryId, {
      id: r.id,
      description: r.description,
      source: "rule",
      cadence: ruleCadenceLabel(r.frequency, r.interval),
      monthlyAmount: monthlyAmount(r.amount, r.frequency, r.interval),
    });
  }

  for (const d of detected) {
    if (d.type !== "EXPENSE") continue;
    add(d.categoryId, {
      id: d.key,
      description: d.description,
      source: "detected",
      cadence: d.cadence,
      monthlyAmount: monthlyAmount(d.amount, d.frequency, d.interval),
    });
  }

  const categories: CategorySuggestion[] = [...byCategory.entries()].map(([categoryId, items]) => {
    const totalCents = items.reduce((s, i) => s + toCents(i.monthlyAmount), 0);
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
