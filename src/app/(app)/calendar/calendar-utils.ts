import type { CalendarEvent } from "@/lib/calendar";
import type { TransactionDTO } from "@/lib/queries";

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
    recurringRuleId: e.recurringRuleId,
    plaidTransactionId: e.plaidTransactionId,
    createdBy: e.createdBy,
  };
}
