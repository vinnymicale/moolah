"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Copy, Check, Loader2, CalendarRange, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { SuggestBudgetModal } from "./SuggestBudgetModal";
import { CategoryIcon } from "@/components/CategoryIcon";
import { StatCard } from "@/components/ui-bits";
import { formatUSD } from "@/lib/money";
import { useDemoStoreOrNull } from "@/components/DemoStore";
import { setBudgetAction, setBudgetRolloverAction, copyBudgetsAction, clearMonthBudgetsAction } from "@/actions/budgets";
import type { BudgetLineDTO } from "@/lib/queries";

export function BudgetsManager({
  lines: serverLines,
  monthISO,
  monthTitle,
  prevMonthISO,
  nextMonthISO,
  thisMonthISO,
  prevMonthFull,
  prevMonthTitle,
}: {
  lines: BudgetLineDTO[];
  monthISO: string;
  monthTitle: string;
  prevMonthISO: string;
  nextMonthISO: string;
  thisMonthISO: string;
  prevMonthFull: string;
  prevMonthTitle: string;
}) {
  const [copyPending, startCopy] = useTransition();
  const [copyError, setCopyError] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  // In demo mode budgets live in the client store so edits show up in-session.
  const demo = useDemoStoreOrNull();
  const lines = demo ? demo.budgets : serverLines;

  const budgeted = useMemo(
    () => lines.filter((l) => l.limit > 0).sort((a, b) => b.limit - a.limit),
    [lines],
  );
  const unbudgeted = useMemo(() => lines.filter((l) => l.limit <= 0), [lines]);

  const totalBudget = budgeted.reduce((s, l) => s + l.effectiveLimit, 0);
  const totalSpent = lines.reduce((s, l) => s + l.actual, 0);
  const budgetedSpent = budgeted.reduce((s, l) => s + l.actual, 0);
  const remaining = totalBudget - budgetedSpent;

  const copyPrev = () =>
    startCopy(async () => {
      setCopyError(null);
      if (demo) {
        // The demo dataset has one month of budgets; "copy" restores the seed.
        demo.resetBudgets();
        return;
      }
      const res = await copyBudgetsAction({ fromMonth: prevMonthFull, toMonth: monthISO });
      if (!res.ok) setCopyError(res.error);
    });

  const [clearPending, startClear] = useTransition();
  const [clearOpen, setClearOpen] = useState(false);
  const doClear = () => {
    setClearOpen(false);
    startClear(async () => {
      setCopyError(null);
      if (demo) {
        demo.clearBudgets();
        return;
      }
      const res = await clearMonthBudgetsAction({ month: monthISO });
      if (!res.ok) setCopyError(res.error);
    });
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={`/budgets?m=${prevMonthISO}`} className="btn-ghost h-9 w-9 p-0!" aria-label="Previous month">
            <ChevronLeft size={18} />
          </Link>
          <h1 className="min-w-44 text-center text-lg font-semibold md:text-xl">{monthTitle}</h1>
          <Link href={`/budgets?m=${nextMonthISO}`} className="btn-ghost h-9 w-9 p-0!" aria-label="Next month">
            <ChevronRight size={18} />
          </Link>
          <Link href={`/budgets?m=${thisMonthISO}`} className="btn-ghost ml-1 hidden h-9 text-sm sm:inline-flex">
            This month
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/budgets?view=year&y=${monthISO.slice(0, 4)}`} className="btn-ghost h-9 text-sm" title="Annual overview">
            <CalendarRange size={15} /> <span className="hidden sm:inline">Year</span>
          </Link>
          <button onClick={copyPrev} disabled={copyPending} className="btn-ghost h-9 text-sm" title={`Copy limits from ${prevMonthTitle}`}>
            {copyPending ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}
            <span className="hidden sm:inline">Copy {prevMonthTitle}</span>
          </button>
          <button onClick={() => setSuggestOpen(true)} className="btn-ghost h-9 text-sm" title="Suggest a budget from recurring charges">
            <Sparkles size={15} /> <span className="hidden sm:inline">Suggest</span>
          </button>
          {budgeted.length > 0 && (
            <button onClick={() => setClearOpen(true)} disabled={clearPending} className="btn-ghost h-9 text-sm" title={`Delete every budget for ${monthTitle}`}>
              {clearPending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              <span className="hidden sm:inline">Clear</span>
            </button>
          )}
        </div>
      </div>

      {copyError && <p className="mb-3 text-sm text-expense">{copyError}</p>}

      {/* Summary */}
      <div className="stagger mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard label="Budgeted" value={formatUSD(totalBudget)} hint={`${budgeted.length} categor${budgeted.length === 1 ? "y" : "ies"}`} />
        <StatCard label="Spent (budgeted)" value={formatUSD(budgetedSpent)} tone="expense" hint={`${formatUSD(totalSpent)} across all categories`} />
        <StatCard
          label="Remaining"
          value={formatUSD(remaining)}
          tone={remaining >= 0 ? "income" : "expense"}
          hint={remaining >= 0 ? "Left to spend" : "Over budget"}
        />
      </div>

      {/* Budgeted categories */}
      <div className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3 font-semibold">This month&apos;s budgets</div>
        {budgeted.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-muted">No budgets set for {monthTitle}.</p>
            <div className="mt-3 flex items-center justify-center gap-2">
              <button onClick={() => setSuggestOpen(true)} className="btn-ghost text-sm">
                <Sparkles size={15} /> Suggest from recurring charges
              </button>
              <button onClick={copyPrev} disabled={copyPending} className="btn-ghost text-sm">
                <Copy size={15} /> Copy from {prevMonthTitle}
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">…or set a limit on any category below.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {budgeted.map((l) => (
              <BudgetRow key={l.categoryId} line={l} monthISO={monthISO} />
            ))}
          </ul>
        )}
      </div>

      {/* Unbudgeted categories */}
      {unbudgeted.length > 0 && (
        <div className="card mt-5 overflow-hidden">
          <div className="border-b border-line px-4 py-3 font-semibold text-muted">Set a budget</div>
          <ul className="divide-y divide-line">
            {unbudgeted.map((l) => (
              <BudgetRow key={l.categoryId} line={l} monthISO={monthISO} />
            ))}
          </ul>
        </div>
      )}

      <SuggestBudgetModal open={suggestOpen} onClose={() => setSuggestOpen(false)} monthISO={monthISO} monthTitle={monthTitle} />

      <Modal open={clearOpen} onClose={() => setClearOpen(false)} title="Clear budgets" widthClass="max-w-sm">
        <p className="text-sm text-muted">
          Delete all {budgeted.length} budget{budgeted.length === 1 ? "" : "s"} for {monthTitle}? Spending history is not affected.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setClearOpen(false)} className="btn-ghost text-sm">
            Cancel
          </button>
          <button onClick={doClear} className="btn-danger">
            <Trash2 size={15} /> Clear {monthTitle}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function BudgetRow({ line, monthISO }: { line: BudgetLineDTO; monthISO: string }) {
  const demo = useDemoStoreOrNull();
  const [value, setValue] = useState(line.limit > 0 ? String(line.limit) : "");
  const [pending, start] = useTransition();
  const [rolloverPending, startRollover] = useTransition();
  const [justSaved, setJustSaved] = useState(false);

  const hasBudget = line.limit > 0;
  const effective = line.effectiveLimit;
  const pct = hasBudget ? (effective > 0 ? Math.min(100, (line.actual / effective) * 100) : 100) : 0;
  const over = hasBudget && line.actual > effective;
  const near = hasBudget && !over && pct >= 80;
  const remaining = effective - line.actual;
  const barColor = over ? "var(--expense)" : near ? "var(--warning)" : line.color;

  const save = () => {
    const next = Math.max(0, Number(value.replace(/[^0-9.]/g, "")) || 0);
    if (next === line.limit) return;
    start(async () => {
      if (demo) {
        demo.setBudget(line.categoryId, next);
      } else {
        const res = await setBudgetAction({ categoryId: line.categoryId, month: monthISO, limit: next });
        if (!res.ok) return;
      }
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    });
  };

  const toggleRollover = () =>
    startRollover(async () => {
      if (demo) {
        demo.setBudgetRollover(line.categoryId, !line.rollover);
        return;
      }
      await setBudgetRolloverAction({ categoryId: line.categoryId, month: monthISO, rollover: !line.rollover });
    });

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${line.color}22`, color: line.color }}>
          <CategoryIcon name={line.icon} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <Link href={`/transactions?category=${line.categoryId}&m=${monthISO.slice(0, 7)}`} className="truncate text-sm font-medium hover:text-brand hover:underline" title={`View ${line.name} transactions`}>
            {line.name}
          </Link>
          {hasBudget ? (
            <p className="text-xs text-muted">
              {formatUSD(line.actual)} spent ·{" "}
              <span className={over ? "text-expense" : "text-muted"}>
                {over ? `${formatUSD(-remaining)} over` : `${formatUSD(remaining)} left`}
              </span>
              {line.rollover && line.carryover !== 0 && (
                <span> · {line.carryover > 0 ? "+" : ""}{formatUSD(line.carryover)} rolled over</span>
              )}
            </p>
          ) : (
            <p className="text-xs text-muted">{formatUSD(line.actual)} spent · no budget</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {pending ? (
            <Loader2 size={14} className="animate-spin text-muted" />
          ) : justSaved ? (
            <Check size={14} className="text-income" />
          ) : null}
          {hasBudget && (
            <button
              onClick={toggleRollover}
              disabled={rolloverPending}
              aria-pressed={line.rollover}
              title={line.rollover ? "Rollover on: last month's leftover adds to this limit" : "Roll over last month's leftover into this limit"}
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                line.rollover ? "bg-brand/15 text-brand" : "text-muted hover:bg-surface2 hover:text-text"
              }`}
            >
              {rolloverPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </button>
          )}
          <div className="relative w-28">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
            <input
              className="input h-9 pl-6 pr-2 text-right money"
              inputMode="decimal"
              placeholder="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
        </div>
      </div>
      {hasBudget && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface2">
          <div className="bar-fill h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
        </div>
      )}
    </li>
  );
}
