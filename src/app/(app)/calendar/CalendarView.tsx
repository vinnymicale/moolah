"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, CalendarCheck, Clock, CreditCard, Repeat } from "lucide-react";
import { Modal } from "@/components/Modal";
import { TransactionModal } from "@/components/TransactionModal";
import { formatUSD, formatUSDWhole } from "@/lib/money";
import { monthLabel } from "@/lib/dates";
import { materializeOccurrenceAction } from "@/actions/transactions";
import type { AccountDTO, CategoryDTO, TransactionDTO } from "@/lib/queries";
import type { CalendarEvent, CalendarMonth, CcDueEvent } from "@/lib/calendar";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type ModalState =
  | { kind: "add"; date: string }
  | { kind: "edit"; txn: TransactionDTO }
  | { kind: "occurrence"; event: CalendarEvent }
  | { kind: "day"; iso: string; events: CalendarEvent[]; ccDues: CcDueEvent[] }
  | { kind: "cc_due"; due: CcDueEvent }
  | null;

export function CalendarView({
  data,
  accounts,
  categories,
  monthISO,
  prevMonthISO,
  nextMonthISO,
  thisMonthISO,
}: {
  data: CalendarMonth;
  accounts: AccountDTO[];
  categories: CategoryDTO[];
  monthISO: string;
  prevMonthISO: string;
  nextMonthISO: string;
  thisMonthISO: string;
}) {
  const [modal, setModal] = useState<ModalState>(null);
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const monthNum = monthISO.slice(0, 7);

  const net = data.monthIncome - data.monthExpense;
  const endOfMonthBalance = data.projection.length ? data.projection[data.projection.length - 1].balance : data.anchorBalance;
  const lowest = data.projection.reduce(
    (min, p) => (p.balance < min.balance ? p : min),
    data.projection[0] ?? { iso: "", balance: data.anchorBalance },
  );
  const hasCash = accounts.some((a) => a.includeInCash);

  const colorFor = (e: CalendarEvent) =>
    e.categoryId ? catById.get(e.categoryId)?.color ?? "#64748b" : e.type === "INCOME" ? "#16a34a" : "#64748b";

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={`/calendar?m=${prevMonthISO.slice(0, 7)}`} className="btn-ghost h-9 w-9 !p-0" aria-label="Previous month">
            <ChevronLeft size={18} />
          </Link>
          <h1 className="min-w-44 text-center text-lg font-semibold md:text-xl">{monthLabel(new Date(`${monthISO}T00:00:00Z`))}</h1>
          <Link href={`/calendar?m=${nextMonthISO.slice(0, 7)}`} className="btn-ghost h-9 w-9 !p-0" aria-label="Next month">
            <ChevronRight size={18} />
          </Link>
          <Link href={`/calendar?m=${thisMonthISO.slice(0, 7)}`} className="btn-ghost ml-1 hidden h-9 text-sm sm:inline-flex">
            Today
          </Link>
        </div>
        <button onClick={() => setModal({ kind: "add", date: data.todayISO })} className="btn-primary h-9">
          <Plus size={16} /> Add
        </button>
      </div>

      {/* Summary */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Summary label="Income" value={formatUSD(data.monthIncome)} tone="income" />
        <Summary label="Expenses" value={formatUSD(data.monthExpense)} tone="expense" />
        <Summary label="Net" value={formatUSD(net)} tone={net >= 0 ? "income" : "expense"} />
        {hasCash && <Summary label="Projected end-of-month" value={formatUSD(endOfMonthBalance)} tone={endOfMonthBalance >= 0 ? "default" : "expense"} />}
      </div>

      {hasCash && lowest.balance < 0 && (
        <div className="mb-4 rounded-lg border border-expense/40 bg-expense/10 px-4 py-2 text-sm text-expense">
          Heads up — projected cash dips to {formatUSD(lowest.balance)} on {formatDayLabel(lowest.iso)}.
        </div>
      )}

      {/* Calendar grid */}
      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line bg-surface2 text-center text-xs font-medium text-muted">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2">
              <span className="hidden sm:inline">{d}</span>
              <span className="sm:hidden">{d[0]}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {data.days.map((iso, i) => {
            const events = data.eventsByDay[iso] ?? [];
            const ccDues = data.ccDueByDay[iso] ?? [];
            const proj = data.projectionByIso[iso];
            const inMonth = iso.slice(0, 7) === monthNum;
            const isToday = iso === data.todayISO;
            return (
              <DayCell
                key={iso}
                iso={iso}
                events={events}
                ccDues={ccDues}
                projBalance={hasCash ? proj?.balance : undefined}
                inMonth={inMonth}
                isToday={isToday}
                lastCol={i % 7 === 6}
                lastRow={i >= 35}
                colorFor={colorFor}
                onAdd={() => setModal({ kind: "add", date: iso })}
                onEvent={(e) =>
                  e.isVirtual
                    ? setModal({ kind: "occurrence", event: e })
                    : setModal({ kind: "edit", txn: eventToTxn(e) })
                }
                onShowAll={(events) => setModal({ kind: "day", iso, events, ccDues })}
                onCcDue={(due) => setModal({ kind: "cc_due", due })}
              />
            );
          })}
        </div>
      </div>

      {modal?.kind === "add" && (
        <TransactionModal open onClose={() => setModal(null)} accounts={accounts} categories={categories} defaultDate={modal.date} />
      )}
      {modal?.kind === "edit" && (
        <TransactionModal open onClose={() => setModal(null)} accounts={accounts} categories={categories} transaction={modal.txn} />
      )}
      {modal?.kind === "occurrence" && (
        <OccurrenceModal event={modal.event} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "day" && (
        <DayEventsModal
          iso={modal.iso}
          events={modal.events}
          ccDues={modal.ccDues}
          categories={categories}
          onEvent={(e) => {
            setModal(
              e.isVirtual
                ? { kind: "occurrence", event: e }
                : { kind: "edit", txn: eventToTxn(e) },
            );
          }}
          onCcDue={(due) => setModal({ kind: "cc_due", due })}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "cc_due" && (
        <CcDueModal due={modal.due} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function DayCell({
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
          const daysUntil = Math.ceil((new Date(`${due.dueDate}T00:00:00Z`).getTime() - Date.now()) / 86_400_000);
          const urgent = daysUntil <= 3;
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
            <span className={`ml-auto shrink-0 tabular-nums ${e.type === "INCOME" ? "text-income" : "text-expense"}`}>
              {e.type === "INCOME" ? "+" : "−"}
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

function DayEventsModal({
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
  const income = events.filter((e) => e.type === "INCOME").reduce((s, e) => s + e.amount, 0);
  const expense = events.filter((e) => e.type === "EXPENSE").reduce((s, e) => s + e.amount, 0);

  return (
    <Modal open onClose={onClose} title={formatDayLabel(iso)} widthClass="max-w-sm">
      <div className="space-y-1">
        {ccDues.map((due) => {
          const daysUntil = Math.ceil((new Date(`${due.dueDate}T00:00:00Z`).getTime() - Date.now()) / 86_400_000);
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
                <p className={`text-xs ${daysUntil < 0 ? "text-expense" : "text-muted"}`}>
                  Payment due · {daysUntil < 0 ? "past due" : daysUntil === 0 ? "today" : `${daysUntil}d`}
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
                style={{ backgroundColor: `${cat?.color ?? (e.type === "INCOME" ? "#16a34a" : "#64748b")}22`, color: cat?.color ?? (e.type === "INCOME" ? "#16a34a" : "#64748b") }}
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
                  {cat?.name ?? (e.isVirtual ? "Expected" : "Uncategorized")}
                </p>
              </div>
              <span className={`shrink-0 tabular-nums text-sm font-semibold ${e.type === "INCOME" ? "text-income" : "text-expense"}`}>
                {e.type === "INCOME" ? "+" : "−"}{formatUSD(e.amount)}
              </span>
            </button>
          );
        })}
      </div>
      {events.length > 1 && (
        <div className="mt-3 flex justify-between border-t border-line pt-3 text-sm">
          <span className="text-income">+{formatUSD(income)}</span>
          <span className="text-expense">−{formatUSD(expense)}</span>
          <span className="font-semibold">Net {formatUSD(income - expense)}</span>
        </div>
      )}
    </Modal>
  );
}

function OccurrenceModal({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const [pending, start] = useTransition();
  const markPaid = () =>
    start(async () => {
      if (event.recurringRuleId) {
        await materializeOccurrenceAction(event.recurringRuleId, event.date, true);
      }
      onClose();
    });

  return (
    <Modal open onClose={onClose} title="Expected transaction" widthClass="max-w-sm">
      <div className="space-y-4">
        <div className="rounded-lg border border-line p-3">
          <div className="flex items-center justify-between">
            <span className="font-medium">{event.description}</span>
            <span className={`tabular-nums font-semibold ${event.type === "INCOME" ? "text-income" : "text-expense"}`}>
              {event.type === "INCOME" ? "+" : "−"}
              {formatUSD(event.amount)}
            </span>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
            <Repeat size={12} /> Recurring · {formatDayLabel(event.date)}
          </p>
        </div>
        <p className="text-sm text-muted">
          This is projected from a recurring rule. Mark it as {event.type === "INCOME" ? "received" : "paid"} once it actually happens.
        </p>
        <div className="flex flex-col gap-2">
          <button onClick={markPaid} disabled={pending} className="btn-primary">
            <CalendarCheck size={16} /> Mark as {event.type === "INCOME" ? "received" : "paid"}
          </button>
          <Link href="/recurring" className="btn-ghost">
            Edit the recurring series
          </Link>
        </div>
      </div>
    </Modal>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone: "default" | "income" | "expense" }) {
  const c = tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : "text-text";
  return (
    <div className="card px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${c}`}>{value}</p>
    </div>
  );
}

function eventToTxn(e: CalendarEvent): TransactionDTO {
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

function CcDueModal({ due, onClose }: { due: CcDueEvent; onClose: () => void }) {
  const daysUntil = Math.ceil((new Date(`${due.dueDate}T00:00:00Z`).getTime() - Date.now()) / 86_400_000);
  return (
    <Modal open onClose={onClose} title={`${due.accountName} — Payment Due`} widthClass="max-w-sm">
      <div className="space-y-3 text-sm">
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3">
          <p className="text-xs text-muted">Due date</p>
          <p className="font-semibold">{formatDayLabel(due.dueDate)}</p>
          <p className={`text-xs ${daysUntil < 0 ? "text-expense font-semibold" : daysUntil <= 3 ? "text-expense" : "text-muted"}`}>
            {daysUntil < 0 ? "Past due" : daysUntil === 0 ? "Due today" : `${daysUntil} day${daysUntil === 1 ? "" : "s"} away`}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {due.statementBalance !== null && (
            <div className="rounded-lg bg-surface2 px-3 py-2">
              <p className="text-xs text-muted">Statement balance</p>
              <p className="tabular-nums font-semibold text-expense">{formatUSD(due.statementBalance)}</p>
            </div>
          )}
          {due.minimumPayment !== null && (
            <div className="rounded-lg bg-surface2 px-3 py-2">
              <p className="text-xs text-muted">Minimum payment</p>
              <p className="tabular-nums font-semibold">{formatUSD(due.minimumPayment)}</p>
            </div>
          )}
        </div>
        <button onClick={onClose} className="btn-ghost w-full">Close</button>
      </div>
    </Modal>
  );
}

function compact(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `$${n.toFixed(n % 1 === 0 ? 0 : 0)}`;
}

function formatDayLabel(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
