import type { CalendarEvent } from "@/lib/calendar";
import type { TransactionDTO } from "@/lib/queries";

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MS_PER_DAY = 86_400_000;

/** Whole days from today until an ISO date, negative once it's in the past. */
export function daysUntilDate(iso: string): number {
  return Math.ceil((new Date(`${iso}T00:00:00Z`).getTime() - Date.now()) / MS_PER_DAY);
}

/** Compact currency for the tight calendar chips, e.g. "$1.2k". */
export function compact(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `$${n.toFixed(0)}`;
}

export function formatDayLabel(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
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
