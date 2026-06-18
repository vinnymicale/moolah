import { CalendarCheck, Clock, CreditCard, Repeat } from "lucide-react";
import { Modal } from "@/components/Modal";
import { formatUSD } from "@/lib/money";
import { categoryColor } from "@/lib/colors";
import { Amount } from "@/components/Amount";
import type { CategoryDTO } from "@/lib/queries";
import type { CalendarEvent, CcDueEvent } from "@/lib/calendar";
import { daysUntilDate, formatMonthDay } from "@/lib/dates";
import { isStatementPayment } from "./calendar-utils";

export function DayEventsModal({
  iso,
  events,
  ccDues,
  categories,
  onEvent,
  onCcDue,
  onClose,
}: {
  iso: string;
  events: CalendarEvent[];
  ccDues: CcDueEvent[];
  categories: CategoryDTO[];
  onEvent: (e: CalendarEvent) => void;
  onCcDue: (due: CcDueEvent) => void;
  onClose: () => void;
}) {
  const catById = new Map(categories.map((c) => [c.id, c]));
  const income = events.filter((e) => e.type === "INCOME" && !e.isTransfer).reduce((s, e) => s + e.amount, 0);
  const expense = events
    .filter((e) => e.type === "EXPENSE" && (!e.isTransfer || isStatementPayment(e)))
    .reduce((s, e) => s + e.amount, 0);

  return (
    <Modal open onClose={onClose} title={formatMonthDay(iso)} widthClass="max-w-sm">
      <div className="space-y-1">
        {ccDues.map((due) => {
          const daysUntil = daysUntilDate(due.dueDate);
          const pastDue = due.isOverdue === true;
          return (
            <button
              key={due.accountId}
              onClick={() => { onCcDue(due); onClose(); }}
              className="flex w-full items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-left hover:bg-warning/20"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/20 text-warning">
                <CreditCard size={13} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" style={{ color: due.color }}>{due.accountName}</p>
                <p className={`text-xs ${pastDue ? "text-expense" : "text-muted"}`}>
                  Payment due · {pastDue ? "past due" : daysUntil < 0 ? "paid" : daysUntil === 0 ? "today" : `${daysUntil}d`}
                </p>
              </div>
              {due.statementBalance !== null && (
                <span className="shrink-0 tabular-nums text-sm font-semibold text-expense">
                  {formatUSD(due.statementBalance)}
                </span>
              )}
            </button>
          );
        })}
        {events.map((e) => {
          const cat = e.categoryId ? catById.get(e.categoryId) : undefined;
          return (
            <button
              key={e.id}
              onClick={() => { onEvent(e); onClose(); }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface2 ${e.isVirtual ? "opacity-60" : ""}`}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs"
                style={{ backgroundColor: `${categoryColor(cat, e.type)}22`, color: categoryColor(cat, e.type) }}
              >
                {e.isVirtual ? <Repeat size={13} /> : <CalendarCheck size={13} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {e.description}
                  {!e.cleared && !e.isVirtual && (
                    <span className="ml-2 inline-flex items-center gap-0.5 align-middle text-[11px] text-warning">
                      <Clock size={11} /> {e.plaidTransactionId ? "pending" : "expected"}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted">
                  {e.isTransfer && !isStatementPayment(e)
                    ? "Card payment · not counted as income"
                    : cat?.name ?? (e.isVirtual ? "Expected" : "Uncategorized")}
                </p>
              </div>
              <Amount type={e.type} amount={e.amount} isTransfer={e.isTransfer} asExpense={isStatementPayment(e)} className="shrink-0 text-sm font-semibold" />
            </button>
          );
        })}
      </div>
      {events.length > 1 && (
        <div className="mt-3 flex justify-between border-t border-line pt-3 text-sm">
          <span className="text-income">+{formatUSD(income)}</span>
          <span className="text-expense">-{formatUSD(expense)}</span>
          <span className="font-semibold">Net {formatUSD(income - expense)}</span>
        </div>
      )}
    </Modal>
  );
}
