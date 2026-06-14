// Category-split expansion.
//
// A transaction can be attributed to a single category (transaction.categoryId)
// or split across several (TransactionSplit rows). Every place that sums money
// by category should iterate the (categoryId, amount) pairs a transaction
// contributes rather than reading categoryId directly, so split and unsplit
// transactions are handled uniformly.
//
// Invariant: when splits exist, transaction.categoryId is null and the split
// amounts sum to the transaction amount. When no splits exist, the single
// categoryId carries the full amount.

import { toCents, fromCents } from "@/lib/money";

export interface SplitLike {
  categoryId: string | null;
  amount: number;
}

export interface SplittableTxn {
  categoryId: string | null;
  amount: number;
  splits?: SplitLike[] | null;
}

export interface CategoryPart {
  categoryId: string | null;
  amount: number;
}

/**
 * Yield the per-category amounts a transaction contributes. Splits take
 * precedence; otherwise the whole amount lands on the single category.
 */
export function categoryParts(txn: SplittableTxn): CategoryPart[] {
  if (txn.splits && txn.splits.length > 0) {
    return txn.splits.map((s) => ({ categoryId: s.categoryId, amount: s.amount }));
  }
  return [{ categoryId: txn.categoryId, amount: txn.amount }];
}

/**
 * Sum a set of split-bearing rows into per-category dollar totals, fanning each
 * row out through categoryParts() so split and unsplit rows are handled the
 * same way. Uncategorized parts (null categoryId) are dropped - callers that
 * track them do so explicitly. Accumulation is in integer cents to avoid float
 * drift across many rows; the returned map holds dollars.
 */
export function sumPartsByCategory(rows: SplittableTxn[]): Map<string, number> {
  const cents = new Map<string, number>();
  for (const row of rows) {
    for (const part of categoryParts(row)) {
      if (!part.categoryId) continue;
      cents.set(part.categoryId, (cents.get(part.categoryId) ?? 0) + toCents(part.amount));
    }
  }
  const dollars = new Map<string, number>();
  for (const [cat, c] of cents) dollars.set(cat, fromCents(c));
  return dollars;
}

/**
 * Validate a proposed set of splits against a transaction total. Returns an
 * error string when invalid, or null when the splits are acceptable. Empty
 * splits are valid (means "not split"). Comparison is done in integer cents.
 */
export function validateSplits(total: number, splits: SplitLike[]): string | null {
  if (splits.length === 0) return null;
  if (splits.length < 2) return "A split needs at least two parts.";
  for (const s of splits) {
    if (!(s.amount > 0)) return "Each split part must be greater than zero.";
  }
  // A named category may appear at most once. (Multiple uncategorized parts are
  // fine - they all fold into the single null bucket when summed.)
  const seen = new Set<string>();
  for (const s of splits) {
    if (!s.categoryId) continue;
    if (seen.has(s.categoryId)) return "Each category can only appear once in a split.";
    seen.add(s.categoryId);
  }
  const sum = splits.reduce((acc, s) => acc + toCents(s.amount), 0);
  if (sum !== toCents(total)) return "Split amounts must add up to the transaction total.";
  return null;
}
