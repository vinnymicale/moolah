// Cash-flow projection.
//
// Produces the running "projected cash" line shown on the calendar. The model:
//
//   • Cash accounts carry a `currentBalance` that is the truth as of the END of
//     the anchor day (normally today).
//   • Every cash-affecting transaction (actual *and* expected/recurring) has a
//     signed effect: +amount for INCOME, -amount for EXPENSE.
//   • For any day D the projected end-of-day balance is:
//        anchorBalance + ( C(D) - C(anchorDay) )
//     where C(x) is the cumulative signed sum of all transactions dated on or
//     before x. This single formula handles past days (reconstructing history)
//     and future days (projecting expected activity) uniformly.

import { toCents, fromCents } from "./money";
import { isoDay, toUTCDay } from "./dates";

export type ProjTxnType = "INCOME" | "EXPENSE";

export interface ProjTxn {
  date: Date | string;
  amount: number | string;
  type: ProjTxnType;
}

export interface DayProjection {
  day: Date;
  iso: string;
  /** Income dollars landing on this day. */
  income: number;
  /** Expense dollars landing on this day (positive number). */
  expense: number;
  /** Net dollars for the day (income - expense). */
  net: number;
  /** Projected end-of-day cash balance in dollars. */
  balance: number;
}

interface ProjectionOptions {
  /** Ordered list of days to produce projections for (e.g. the calendar grid). */
  days: Date[];
  /** Day at which `anchorBalance` is exact (end of day). Defaults to today UTC. */
  anchorDate: Date;
  /** Known cash balance (dollars) at end of anchorDate. */
  anchorBalance: number;
  /** All cash-affecting transactions/occurrences relevant to the window. */
  txns: ProjTxn[];
}

function signedCents(t: ProjTxn): number {
  const c = toCents(t.amount);
  return t.type === "INCOME" ? c : -c;
}

export function projectDailyBalances(opts: ProjectionOptions): DayProjection[] {
  const anchorIso = isoDay(toUTCDay(opts.anchorDate));
  const anchorCents = toCents(opts.anchorBalance);

  // Per-day aggregates (in cents) keyed by ISO day.
  const incomeByDay = new Map<string, number>();
  const expenseByDay = new Map<string, number>();
  const netByDay = new Map<string, number>();

  for (const t of opts.txns) {
    const iso = isoDay(toUTCDay(t.date));
    const c = toCents(t.amount);
    if (t.type === "INCOME") {
      incomeByDay.set(iso, (incomeByDay.get(iso) ?? 0) + c);
    } else {
      expenseByDay.set(iso, (expenseByDay.get(iso) ?? 0) + c);
    }
    netByDay.set(iso, (netByDay.get(iso) ?? 0) + signedCents(t));
  }

  // Cumulative signed sum C(x) over every distinct transaction day, ascending.
  const txnDays = Array.from(netByDay.keys()).sort();
  const cumulativeAt = new Map<string, number>(); // iso -> C(iso) inclusive
  let running = 0;
  for (const iso of txnDays) {
    running += netByDay.get(iso) ?? 0;
    cumulativeAt.set(iso, running);
  }

  // C(D) = cumulative sum of all txn-days <= D. Resolve via the sorted list.
  const cAt = (iso: string): number => {
    // Binary search for the last txnDay <= iso.
    let lo = 0;
    let hi = txnDays.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (txnDays[mid] <= iso) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return idx === -1 ? 0 : cumulativeAt.get(txnDays[idx])!;
  };

  const cAnchor = cAt(anchorIso);

  return opts.days.map((day) => {
    const d = toUTCDay(day);
    const iso = isoDay(d);
    const balanceCents = anchorCents + (cAt(iso) - cAnchor);
    return {
      day: d,
      iso,
      income: fromCents(incomeByDay.get(iso) ?? 0),
      expense: fromCents(expenseByDay.get(iso) ?? 0),
      net: fromCents(netByDay.get(iso) ?? 0),
      balance: fromCents(balanceCents),
    };
  });
}

/**
 * Find the lowest projected balance and the day it occurs across a projection —
 * useful for "you'll dip to $X on the 23rd" warnings.
 */
export function lowestPoint(projections: DayProjection[]): DayProjection | null {
  if (projections.length === 0) return null;
  return projections.reduce((min, p) => (p.balance < min.balance ? p : min));
}
