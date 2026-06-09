import { CreditCard } from "lucide-react";
import { formatUSD, formatUSDWhole } from "@/lib/money";
import type { CalendarEvent, CcDueEvent } from "@/lib/calendar";
import { compact, daysUntilDate } from "./calendar-utils";

export function DayCell({
  iso,
  events,
  ccDues,
  projBalance,
  inMonth,
  isToday,
  lastCol,
  lastRow,
  colorFor,
  onAdd,
  onEvent,
  onShowAll,
  onCcDue,
}: {
  iso: string;
  events: CalendarEvent[];
  ccDues: CcDueEvent[];
  projBalance?: number;
  inMonth: boolean;
  isToday: boolean;
  lastCol: boolean;
  lastRow: boolean;
  colorFor: (e: CalendarEvent) => string;
  onAdd: () => void;
  onEvent: (e: CalendarEvent) => void;
  onShowAll: (events: CalendarEvent[]) => void;
  onCcDue: (due: CcDueEvent) => void;
}) {
  const day = Number(iso.slice(8, 10));
  // Reserve slots for CC due chips so they don't crowd out transactions.
  const maxTxns = Math.max(0, 3 - ccDues.length);
  const visible = events.slice(0, maxTxns);
  const extra = events.length - visible.length;

  return (
    <div
      className={`group relative min-h-24 cursor-pointer p-1.5 md:min-h-28 ${lastCol ? "" : "border-r"} ${lastRow ? "" : "border-b"} border-line ${
        inMonth ? "" : "bg-surface2/40"
      }`}
      onClick={onAdd}
    >
      <div className="mb-1 flex items-center justify-between">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
            isToday ? "bg-brand text-brand-fg" : inMonth ? "text-text" : "text-muted"
          }`}
        >
          {day}
        </span>
        {projBalance !== undefined && (
          <span className={`hidden text-[10px] tabular-nums sm:inline ${projBalance < 0 ? "text-expense" : "text-muted"}`}>
            {formatUSDWhole(projBalance)}
          </span>
        )}
      </div>
      <div className="space-y-1">
        {ccDues.map((due) => {
          const daysUntil = daysUntilDate(due.dueDate);
          const urgent = due.isOverdue === true || (daysUntil <= 3 && daysUntil >= 0);
          return (
            <button
              key={due.accountId}
              onClick={(ev) => { ev.stopPropagation(); onCcDue(due); }}
              className="flex w-full items-center gap-1 rounded border border-warning/40 bg-warning/10 px-1 py-0.5 text-left text-[11px] leading-tight hover:bg-warning/20"
              title={`${due.accountName} payment due${due.statementBalance !== null ? ` · ${formatUSD(due.statementBalance)}` : ""}`}
            >
              <CreditCard size={10} className={`shrink-0 ${urgent ? "text-expense" : "text-warning"}`} />
              <span className="hidden flex-1 truncate sm:inline" style={{ color: due.color }}>{due.accountName}</span>
              <span className={`ml-auto shrink-0 tabular-nums ${urgent ? "text-expense" : "text-warning"}`}>
                {due.statementBalance !== null ? compact(due.statementBalance) : "due"}
              </span>
            </button>
          );
        })}
        {visible.map((e) => (
          <button
            key={e.id}
            onClick={(ev) => {
              ev.stopPropagation();
              onEvent(e);
            }}
            className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] leading-tight hover:bg-surface2 ${
              e.isVirtual ? "opacity-60" : ""
            }`}
            title={`${e.description} · ${formatUSD(e.amount)}${e.isVirtual ? " (expected)" : !e.cleared && e.plaidTransactionId ? " (pending)" : ""}`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${!e.cleared && !e.isVirtual ? "opacity-50" : ""}`} style={{ backgroundColor: colorFor(e) }} />
            <span className="hidden flex-1 truncate sm:inline">{e.description}</span>
            <span className={`ml-auto shrink-0 tabular-nums ${
              e.isTransfer ? "text-muted" : e.type === "INCOME" ? "text-income" : "text-expense"
            }`}>
              {e.isTransfer ? "" : e.type === "INCOME" ? "+" : "-"}
              {compact(e.amount)}
            </span>
          </button>
        ))}
        {extra > 0 && (
          <button
            onClick={(ev) => { ev.stopPropagation(); onShowAll(events); }}
            className="px-1 text-[10px] text-brand hover:underline"
          >
            +{extra} more
          </button>
        )}
      </div>
    </div>
  );
}
