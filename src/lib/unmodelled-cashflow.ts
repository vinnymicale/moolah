// Unmodelled cash flow: the part of real income and spending that the user's
// recurring rules do not already project.
//
// The rules capture what people bother to set up as rules - paychecks, rent,
// subscriptions. They almost never capture groceries, gas, restaurants or
// one-off spending. A projection built from rules alone therefore sees most
// inflows and only some outflows, and the gap compounds into a steep, wrong
// climb.
//
// This measures the residual directly from transaction history: take every
// real transaction in a trailing window, drop the ones a rule already accounts
// for, and average what's left into a monthly rate. Adding that rate to the
// rules projection gives a line built entirely from observed cash movement,
// with no after-the-fact fudge factor.

import { isEffectiveTransfer } from "./transfers";
import { parseISODay } from "./dates";

/** A transaction as this module needs to see it. */
export interface CashflowTxn {
  /** ISO day (YYYY-MM-DD). */
  date: string;
  type: "INCOME" | "EXPENSE";
  amount: number;
  /** Set when a recurring rule already projects this transaction. */
  recurringRuleId: string | null;
  isTransfer: boolean;
  /** Owning account's type, for credit-card payment detection. */
  accountType: string | null;
}

// Below this many days of transaction history the residual is too noisy to
// project forward: one unusual month would dominate the whole horizon.
const MIN_WINDOW_DAYS = 45;

const MS_PER_DAY = 86_400_000;
const DAYS_PER_MONTH = 30.44;

/**
 * Average monthly net cash flow that the recurring rules do not already model,
 * measured over `[startISO, endISO)`. Negative means unmodelled spending
 * outweighs unmodelled income, which is the usual case.
 *
 * Returns null when the window is too short to measure, so callers can fall
 * back rather than project from noise. Returns 0 - a real answer, not an
 * absence - when the window is long enough but every transaction in it is
 * already rule-linked.
 */
export function unmodelledMonthlyRate(
  txns: CashflowTxn[],
  startISO: string,
  endISO: string,
): number | null {
  const start = parseISODay(startISO).getTime();
  const end = parseISODay(endISO).getTime();
  const spanDays = (end - start) / MS_PER_DAY;
  if (spanDays < MIN_WINDOW_DAYS) return null;

  let net = 0;
  for (const t of txns) {
    const at = parseISODay(t.date).getTime();
    if (at < start || at >= end) continue;
    // Already projected by a rule: counting it here would double-book it.
    if (t.recurringRuleId) continue;
    // Transfers move money between the user's own accounts, leaving net worth
    // unchanged. isEffectiveTransfer also catches credit-card payment credits,
    // which look like INCOME but are just the other half of a payment.
    if (
      isEffectiveTransfer({
        type: t.type,
        isTransfer: t.isTransfer,
        accountType: t.accountType as Parameters<typeof isEffectiveTransfer>[0]["accountType"],
      })
    )
      continue;
    net += t.type === "INCOME" ? t.amount : -t.amount;
  }
  return net / (spanDays / DAYS_PER_MONTH);
}
