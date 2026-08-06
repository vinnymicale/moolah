"use client";

import { useMemo, useState } from "react";
import { usePersistentState } from "@/lib/usePersistentState";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { Table2, ChevronDown } from "lucide-react";
import { formatUSD, formatUSDWhole } from "@/lib/money";
import { monthsToLabel } from "@/lib/debt-payoff";
import {
  buildSchedule, paymentForTerm, compareExtraPayment, byYear, loanProgress,
} from "@/lib/amortization";
import { localTodayISO } from "@/lib/dates";
import { ChartSkeleton } from "@/components/ChartSkeleton";
import { useChartTheme } from "@/lib/useChartTheme";
import { useMounted } from "@/lib/useMounted";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { StatCard } from "@/components/ui-bits";
import type { AccountDTO } from "@/lib/queries";
import { payoffDateLabel } from "./debt-utils";

export function AmortizationPanel({ loans }: { loans: AccountDTO[] }) {
  // A stale stored id is harmless - the lookup below falls back to the first loan.
  const [selectedId, setSelectedId] = usePersistentState("amortization.loan", loans[0].id);
  const [extra, setExtra] = useState("0");
  const [showTable, setShowTable] = useState(false);
  const theme = useChartTheme();
  const mounted = useMounted();
  const reducedMotion = usePrefersReducedMotion();

  const loan = loans.find((l) => l.id === selectedId) ?? loans[0];

  // Prefer the recorded monthly payment. When the user only gave a term - or
  // recorded a zero payment - derive the level payment that term implies.
  const payment =
    loan.minimumPayment ||
    paymentForTerm(loan.currentBalance, loan.interestRate ?? 0, loan.termMonths ?? 0);

  const terms = useMemo(
    () => ({ balance: loan.currentBalance, apr: loan.interestRate ?? 0, payment }),
    [loan.currentBalance, loan.interestRate, payment],
  );

  const extraNum = Math.max(0, Number(extra.replace(/[^0-9.]/g, "")) || 0);
  const schedule = useMemo(() => buildSchedule(terms), [terms]);
  const comparison = useMemo(() => compareExtraPayment(terms, extraNum), [terms, extraNum]);
  const years = useMemo(() => byYear(schedule.rows), [schedule.rows]);

  const progress = useMemo(
    () => loanProgress(loan.originationDate, loan.termMonths, localTodayISO()),
    [loan.originationDate, loan.termMonths],
  );

  // The recorded term and the projected payoff should agree. When they don't,
  // the balance has drifted from schedule or the payment on file is stale.
  const projected = comparison ? comparison.base.months : schedule.months;
  const termGap =
    schedule.feasible && loan.termMonths && progress?.monthsRemaining != null
      ? projected - progress.monthsRemaining
      : 0;

  const chartData = years.map((y) => ({
    year: y.year,
    interest: y.interest,
    principal: y.principal,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Loan</p>
          {loans.length > 1 ? (
            <select
              className="input h-9 text-sm"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {loans.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          ) : (
            <p className="flex h-9 items-center gap-2 text-sm font-medium">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: loan.color }} />
              {loan.name}
            </p>
          )}
          <p className="mt-1 text-[11px] text-muted">
            {formatUSD(loan.currentBalance)} at {loan.interestRate}% · {formatUSD(payment)}/mo
            {progress && (
              <>
                {" · "}
                {progress.monthsRemaining != null && loan.termMonths
                  ? `payment ${progress.monthsElapsed + 1} of ${loan.termMonths}`
                  : `${monthsToLabel(progress.monthsElapsed)} in`}
              </>
            )}
          </p>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Extra monthly payment</p>
          <div className="relative w-40">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
            <input
              inputMode="decimal"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              className="input h-9 w-full pl-6 text-sm money"
            />
          </div>
          <p className="mt-1 text-[11px] text-muted">Applied straight to principal</p>
        </div>
      </div>

      {!schedule.feasible ? (
        <div className="rounded-xl border border-expense/40 bg-expense/5 px-4 py-3 text-sm text-expense">
          {schedule.reason}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Paid off in"
              value={monthsToLabel(comparison ? comparison.accelerated.months : schedule.months)}
              tone="brand"
              hint={payoffDateLabel(comparison ? comparison.accelerated.months : schedule.months)}
            />
            <StatCard
              label="Remaining interest"
              value={formatUSD(comparison ? comparison.accelerated.totalInterest : schedule.totalInterest)}
              tone="expense"
              hint={`on ${formatUSD(loan.currentBalance)} outstanding`}
            />
            <StatCard
              label="Saved by overpaying"
              value={comparison && comparison.interestSaved > 0.5 ? formatUSD(comparison.interestSaved) : "-"}
              tone="income"
              hint={
                comparison && comparison.monthsSaved > 0
                  ? `${monthsToLabel(comparison.monthsSaved)} sooner`
                  : "Add an extra payment to save"
              }
            />
          </div>

          {Math.abs(termGap) >= 3 && (
            <p className="rounded-xl border border-line bg-surface px-4 py-2.5 text-xs text-muted">
              At {formatUSD(payment)}/mo this pays off {monthsToLabel(Math.abs(termGap))}{" "}
              {termGap > 0 ? "later" : "sooner"} than the {loan.termMonths}-month term on file.
              Check that the balance and payment are current.
            </p>
          )}

          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold">Where each year&apos;s payments go</h3>
            {!mounted ? <ChartSkeleton height={220} /> : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartData} margin={{ left: 8, right: 8, top: 8 }} stackOffset="none">
                  <CartesianGrid stroke={theme.grid} vertical={false} />
                  <XAxis
                    dataKey="year"
                    tick={{ fill: theme.axis, fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(y) => `${y}y`}
                  />
                  <YAxis
                    tick={{ fill: theme.axis, fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    width={60}
                    tickFormatter={(v) => formatUSDWhole(v)}
                  />
                  <Tooltip
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }}
                    labelFormatter={(y) => `Year ${y}`}
                    formatter={(v, name) => [formatUSD(Number(v)), name === "principal" ? "Principal" : "Interest"]}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 12 }}
                    formatter={(name) => (name === "principal" ? "Principal" : "Interest")}
                  />
                  <Area
                    type="monotone"
                    dataKey="principal"
                    stackId="1"
                    stroke={theme.brand}
                    fill={theme.brand}
                    fillOpacity={0.25}
                    isAnimationActive={!reducedMotion}
                  />
                  <Area
                    type="monotone"
                    dataKey="interest"
                    stackId="1"
                    stroke={theme.expense}
                    fill={theme.expense}
                    fillOpacity={0.25}
                    isAnimationActive={!reducedMotion}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="card overflow-hidden">
            <button
              onClick={() => setShowTable((s) => !s)}
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-surface2"
            >
              <span className="flex items-center gap-2">
                <Table2 size={15} className="text-brand" /> Yearly schedule
              </span>
              <ChevronDown size={15} className={`text-muted transition-transform ${showTable ? "rotate-180" : ""}`} />
            </button>
            {showTable && (
              <div className="overflow-x-auto border-t border-line">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2 text-left font-medium">Year</th>
                      <th className="px-4 py-2 text-right font-medium">Principal</th>
                      <th className="px-4 py-2 text-right font-medium">Interest</th>
                      <th className="px-4 py-2 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {years.map((y) => (
                      <tr key={y.year} className="border-t border-line">
                        <td className="px-4 py-2">{y.year}</td>
                        <td className="px-4 py-2 text-right money">{formatUSD(y.principal)}</td>
                        <td className="px-4 py-2 text-right money text-expense">{formatUSD(y.interest)}</td>
                        <td className="px-4 py-2 text-right money">{formatUSD(y.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
