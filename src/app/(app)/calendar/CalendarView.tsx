"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, TrendingUp, TrendingDown } from "lucide-react";
import { TransactionModal } from "@/components/TransactionModal";
import { formatUSD } from "@/lib/money";
import { formatMonthDay, monthLabel } from "@/lib/dates";
import { DEFAULT_CATEGORY_COLOR, TRANSFER_COLOR, categoryColor } from "@/lib/colors";
import type { AccountDTO, CategoryDTO, TransactionDTO } from "@/lib/queries";
import type { CalendarEvent, CalendarMonth, CcDueEvent } from "@/lib/calendar";
import { WEEKDAYS, eventToTxn, isStatementPayment, computeFilteredTotals } from "./calendar-utils";
import { AccountFilter } from "./AccountFilter";
import { DayCell } from "./DayCell";
import { DayEventsModal } from "./DayEventsModal";
import { OccurrenceModal } from "./OccurrenceModal";
import { CcDueModal } from "./CcDueModal";
import { StatCard } from "@/components/ui-bits";

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
  const [enabledAccountIds, setEnabledAccountIds] = useState<Set<string>>(
    () => new Set(accounts.map((a) => a.id)),
  );
  const [showIncome, setShowIncome] = useState(true);
  const [showExpense, setShowExpense] = useState(true);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const monthNum = monthISO.slice(0, 7);

  // Client-side filtered events and recomputed monthly totals. See
  // computeFilteredTotals for the cash-vs-accrual and actual-vs-projected rules.
  const {
    filteredEventsByDay,
    monthIncome,
    monthExpense,
    monthIncomeActual,
    monthExpenseActual,
    ccCharges,
    ccChargesActual,
  } = useMemo(
    () =>
      computeFilteredTotals(data.eventsByDay, {
        accountTypeById: new Map(accounts.map((a) => [a.id, a.type])),
        enabledAccountIds,
        showIncome,
        showExpense,
        monthNum,
        todayISO: data.todayISO,
      }),
    [data.eventsByDay, data.todayISO, enabledAccountIds, showIncome, showExpense, monthNum, accounts],
  );

  const net = monthIncomeActual - monthExpenseActual;
  const endOfMonthBalance = data.projection.length ? data.projection[data.projection.length - 1].balance : data.anchorBalance;
  const lowest = data.projection.reduce(
    (min, p) => (p.balance < min.balance ? p : min),
    data.projection[0] ?? { iso: "", balance: data.anchorBalance },
  );
  const hasCash = accounts.some((a) => a.includeInCash);
  const hasCreditCard = accounts.some((a) => a.type === "CREDIT_CARD");

  const colorFor = (e: CalendarEvent) =>
    e.isTransfer && !isStatementPayment(e) ? TRANSFER_COLOR
    : e.categoryId ? categoryColor(catById.get(e.categoryId))
    : e.type === "INCOME" ? "var(--income)" : DEFAULT_CATEGORY_COLOR;

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={`/calendar?m=${prevMonthISO.slice(0, 7)}`} className="btn-ghost h-9 w-9 p-0!" aria-label="Previous month">
            <ChevronLeft size={18} />
          </Link>
          <h1 className="min-w-44 text-center text-lg font-semibold md:text-xl">{monthLabel(new Date(`${monthISO}T00:00:00Z`))}</h1>
          <Link href={`/calendar?m=${nextMonthISO.slice(0, 7)}`} className="btn-ghost h-9 w-9 p-0!" aria-label="Next month">
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
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard
          size="sm"
          label="Income"
          value={formatUSD(monthIncomeActual)}
          tone="income"
          hint={`${formatUSD(monthIncome)} projected`}
          info="Money that has landed in your bank accounts so far this month. The projected figure adds expected income through month end. Internal transfers between your accounts are excluded."
        />
        <StatCard
          size="sm"
          label="Expenses"
          value={formatUSD(monthExpenseActual)}
          tone="expense"
          hint={`${formatUSD(monthExpense)} projected`}
          info="Money that has left your bank accounts so far this month, including payments toward credit-card statements. The projected figure adds expected spending through month end. Credit-card charges and internal transfers are excluded."
        />
        <StatCard
          size="sm"
          label="Net"
          value={formatUSD(net)}
          tone={net >= 0 ? "income" : "expense"}
          hint={`${formatUSD(monthIncome - monthExpense)} projected`}
          info="Income minus expenses so far this month - how much your bank balances have changed on net. The projected figure uses the projected income and expenses."
        />
        {hasCreditCard && (
          <StatCard
            size="sm"
            label="Credit card charges"
            value={formatUSD(ccChargesActual)}
            tone="expense"
            hint={`${formatUSD(ccCharges)} projected`}
            info="Charges made to your credit cards this month, counted when they post - not when you pay the statement. These do not affect your bank Expenses or projected balance until you make a payment."
          />
        )}
        {hasCash && (
          <StatCard
            size="sm"
            label="Projected end-of-month"
            value={formatUSD(endOfMonthBalance)}
            tone={endOfMonthBalance >= 0 ? "default" : "expense"}
            info="Your expected total cash balance on the last day of the month - today's balance plus all projected income and expenses (including credit-card payments) through month end."
          />
        )}
      </div>

      {/* Account + type filters */}
      {accounts.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface2/50 px-3 py-2">
          <span className="mr-1 text-xs font-medium text-muted">Show:</span>

          {/* Income / Expense toggles */}
          <button
            onClick={() => setShowIncome((v) => !v)}
            className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
              showIncome
                ? "border-income/40 bg-income/10 text-income"
                : "border-line bg-surface2 text-muted opacity-50"
            }`}
          >
            <TrendingUp size={11} /> Income
          </button>
          <button
            onClick={() => setShowExpense((v) => !v)}
            className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
              showExpense
                ? "border-expense/40 bg-expense/10 text-expense"
                : "border-line bg-surface2 text-muted opacity-50"
            }`}
          >
            <TrendingDown size={11} /> Expenses
          </button>

          <span className="mx-1 h-4 w-px bg-line" />

          <AccountFilter
            accounts={accounts}
            enabledAccountIds={enabledAccountIds}
            onChange={setEnabledAccountIds}
          />
        </div>
      )}

      {hasCash && lowest.balance < 0 && (
        <div className="mb-4 rounded-lg border border-expense/40 bg-expense/10 px-4 py-2 text-sm text-expense">
          Heads up - projected cash dips to {formatUSD(lowest.balance)} on {formatMonthDay(lowest.iso)}.
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
            const events = filteredEventsByDay[iso] ?? [];
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
