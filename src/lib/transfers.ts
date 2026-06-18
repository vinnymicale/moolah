// Single source of truth for "does this transaction count as a transfer?".
//
// A transaction is excluded from income/expense totals when it is either:
//  - explicitly paired (isTransfer set by matchTransfers or manual pairing), or
//  - an INCOME row on a credit-card account: a payment credit that reduces the
//    CC balance, not real income (the matching cash outflow was the bank debit).
//
// The second case is a heuristic applied at read time because unpaired CC
// payment credits never get isTransfer written to the row. Every aggregation
// (calendar, dashboard, trends, budgets) must run through this so the same
// transaction is never counted as income in one view and a transfer in another.

import type { AccountType, TxnType } from "@/generated/prisma/enums";

export interface TransferClassifiable {
  type: TxnType;
  isTransfer: boolean;
  /** Account type of the row's account, or null if it has no account. */
  accountType: AccountType | null;
}

/** True when the transaction should be excluded from income/expense totals. */
export function isEffectiveTransfer(t: TransferClassifiable): boolean {
  return t.isTransfer || (t.accountType === "CREDIT_CARD" && t.type === "INCOME");
}
