import type { CalendarEvent } from "@/lib/calendar";
import type { TransactionDTO } from "@/lib/queries";
import type { AccountType } from "@/generated/prisma/enums";

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * True when an event counts as money actually moved (vs. still projected): a
 * real, cleared transaction dated on or before today. Pending transactions and
 * virtual recurring occurrences are projections, as is anything dated after
 * today even if already cleared.
 *
 * Lives here (a client-safe module) rather than in lib/calendar so the calendar
 * client component can import it without pulling the server-only prisma client
 * into the browser bundle. lib/calendar re-exports it for server use.
 */
export function eventIsActual(
  e: Pick<CalendarEvent, "cleared" | "isVirtual" | "date">,
  todayISO: string,
): boolean {
  return e.cleared && !e.isVirtual && e.date <= todayISO;
}

/**
 * A credit-card statement payment: a transfer (EXPENSE) leaving a cash account
 * whose paired transaction sits on a credit-card account. Unlike internal
 * cash-to-cash transfers, this is real money leaving the bank, so it's counted
 * and styled as an ordinary expense rather than a neutral transfer.
 */
export function isStatementPayment(
  e: Pick<CalendarEvent, "isTransfer" | "type" | "transferPeerType">,
): boolean {
  return e.isTransfer && e.type === "EXPENSE" && e.transferPeerType === "CREDIT_CARD";
}

export interface FilteredCalendarTotals {
  /** Events grouped by day after applying the account/type filters. */
  filteredEventsByDay: Record<string, CalendarEvent[]>;
  /** Projected (actual + pending + virtual) bank income for the visible month. */
  monthIncome: number;
  /** Projected bank expense for the visible month (includes statement payments). */
  monthExpense: number;
  /** Income from cleared, on/before-today, non-virtual events only. */
  monthIncomeActual: number;
  /** Expense from cleared, on/before-today, non-virtual events only. */
  monthExpenseActual: number;
  /** Projected credit-card charges (accrual, never moves cash). */
  ccCharges: number;
  /** Actual portion of credit-card charges. */
  ccChargesActual: number;
}

/**
 * Applies the calendar's account/type filters and recomputes the monthly totals
 * client-side. Bank totals cover cash accounts only (so the projection stays a
 * true cash-flow view, including statement payments leaving checking) while
 * credit-card charges get their own accrual total. Each is split into actual
 * (cleared, on/before today, non-virtual) and a projected grand total (actual
 * plus pending + virtual occurrences through month end).
 *
 * Mirrors the server's groupEventsByDay, with the extra filter dimension and the
 * CC-accrual split layered on top. Pure so it can be unit-tested without React.
 */
export function computeFilteredTotals(
  eventsByDay: Record<string, CalendarEvent[]>,
  opts: {
    accountTypeById: Map<string, AccountType>;
    enabledAccountIds: Set<string>;
    showIncome: boolean;
    showExpense: boolean;
    /** "YYYY-MM" prefix of the visible month; spillover days are excluded from totals. */
    monthNum: string;
    todayISO: string;
  },
): FilteredCalendarTotals {
  const { accountTypeById, enabledAccountIds, showIncome, showExpense, monthNum, todayISO } = opts;
  let income = 0;
  let expense = 0;
  let incomeActual = 0;
  let expenseActual = 0;
  let cc = 0;
  let ccActual = 0;
  const byDay: Record<string, CalendarEvent[]> = {};

  for (const [day, events] of Object.entries(eventsByDay)) {
    const filtered = events.filter((e) => {
      if (e.accountId && !enabledAccountIds.has(e.accountId)) return false;
      if (e.type === "INCOME" && !showIncome) return false;
      if (e.type === "EXPENSE" && !showExpense) return false;
      return true;
    });
    byDay[day] = filtered;

    if (day.startsWith(monthNum)) {
      for (const e of filtered) {
        const actual = eventIsActual(e, todayISO);
        const isCredit = e.accountId && accountTypeById.get(e.accountId) === "CREDIT_CARD";
        if (isCredit) {
          // Credit-card charges are accrual-only - they never move cash, so they
          // stay out of the bank totals and the projection. The CC-credit side
          // of a statement payment is a transfer and is skipped here too.
          if (e.type === "EXPENSE" && !e.isTransfer) {
            cc += e.amount;
            if (actual) ccActual += e.amount;
          }
          continue;
        }
        // A statement payment (transfer from a cash account whose peer is a
        // credit card) is real cash leaving the bank, so it counts as a bank
        // expense. Internal cash-to-cash transfers are still excluded.
        if (e.isTransfer && !isStatementPayment(e)) continue;
        if (e.type === "INCOME") {
          income += e.amount;
          if (actual) incomeActual += e.amount;
        } else if (e.type === "EXPENSE") {
          expense += e.amount;
          if (actual) expenseActual += e.amount;
        }
      }
    }
  }

  return {
    filteredEventsByDay: byDay,
    monthIncome: income,
    monthExpense: expense,
    monthIncomeActual: incomeActual,
    monthExpenseActual: expenseActual,
    ccCharges: cc,
    ccChargesActual: ccActual,
  };
}

/** Compact currency for the tight calendar chips, e.g. "$1.2k". */
export function compact(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `$${n.toFixed(0)}`;
}

export function eventToTxn(e: CalendarEvent): TransactionDTO {
  return {
    id: e.id,
    type: e.type,
    amount: e.amount,
    date: e.date,
    description: e.description,
    note: e.note,
    accountId: e.accountId,
    categoryId: e.categoryId,
    cleared: e.cleared,
    // CalendarEvent.isTransfer is already the effective classification.
    isTransfer: e.isTransfer,
    effectiveTransfer: e.isTransfer,
    recurringRuleId: e.recurringRuleId,
    plaidTransactionId: e.plaidTransactionId,
    // Calendar events are single-category; the editor seeds an unsplit form.
    splits: [],
  };
}
