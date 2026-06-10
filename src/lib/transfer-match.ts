// Transfer-pair detection.
//
// A credit-card payment shows up twice: an EXPENSE leaving the bank account
// and an INCOME credit on the card. Counting both distorts income and
// spending, so matched pairs are flagged isTransfer and linked. The matcher is
// pure so it can be unit-tested; callers persist the pairs.

export interface MatchableTxn {
  id: string;
  type: "INCOME" | "EXPENSE";
  /** Integer cents - avoids float comparison issues. */
  amountCents: number;
  dateISO: string; // YYYY-MM-DD
  accountId: string | null;
  isTransfer: boolean;
  transferPeerId: string | null;
}

export interface TransferPair {
  expenseId: string;
  incomeId: string;
}

const DAY_MS = 86_400_000;

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;
}

/**
 * Match credit-card payment credits (INCOME on a CC account) to the bank
 * EXPENSE that funded them: exact amount, within `maxDaysApart` days, neither
 * side already paired. Each credit takes the closest-dated unused expense.
 */
export function findTransferPairs(
  txns: MatchableTxn[],
  isCreditCardAccount: (accountId: string) => boolean,
  maxDaysApart = 5,
): TransferPair[] {
  const credits = txns.filter(
    (t) => t.type === "INCOME" && !t.isTransfer && !t.transferPeerId &&
      t.accountId !== null && isCreditCardAccount(t.accountId),
  );
  const expenses = txns.filter(
    (t) => t.type === "EXPENSE" && !t.isTransfer && !t.transferPeerId &&
      t.accountId !== null && !isCreditCardAccount(t.accountId),
  );

  const pairs: TransferPair[] = [];
  const used = new Set<string>();

  for (const credit of credits) {
    let best: MatchableTxn | null = null;
    let bestDist = Infinity;
    for (const expense of expenses) {
      if (used.has(expense.id)) continue;
      if (expense.amountCents !== credit.amountCents) continue;
      const dist = daysBetween(expense.dateISO, credit.dateISO);
      if (dist > maxDaysApart) continue;
      if (dist < bestDist) {
        best = expense;
        bestDist = dist;
      }
    }
    if (best) {
      used.add(best.id);
      pairs.push({ expenseId: best.id, incomeId: credit.id });
    }
  }

  return pairs;
}
