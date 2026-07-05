// Helpers shared by the query modules. Not exported from the barrel.

import { toNumber, type MoneyInput } from "@/lib/money";
import type { SplittableTxn } from "@/lib/splits";

/** A transaction row selected with its splits, where money is still a Decimal. */
export type RowWithSplits = {
  categoryId: string | null;
  amount: MoneyInput;
  splits: { categoryId: string | null; amount: MoneyInput }[];
};

/** Convert a DB row's Decimal money fields to numbers for split fan-out. */
export function rowToSplittable(t: RowWithSplits): SplittableTxn {
  return {
    categoryId: t.categoryId,
    amount: toNumber(t.amount),
    splits: t.splits.map((s) => ({ categoryId: s.categoryId, amount: toNumber(s.amount) })),
  };
}
