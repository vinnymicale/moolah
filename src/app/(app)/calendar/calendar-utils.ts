import type { CalendarEvent } from "@/lib/calendar";
import type { TransactionDTO } from "@/lib/queries";

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
    isTransfer: e.isTransfer,
    recurringRuleId: e.recurringRuleId,
    plaidTransactionId: e.plaidTransactionId,
    // Calendar events are single-category; the editor seeds an unsplit form.
    splits: [],
  };
}
