"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { TrendingDown, Snowflake, Mountain, AlertTriangle, ArrowRight } from "lucide-react";
import { formatUSD, formatUSDWhole } from "@/lib/money";
import { simulatePayoff, monthsToLabel, type Strategy, type DebtInput } from "@/lib/debt-payoff";
import { toggleInSet } from "@/lib/collections";
import { ChartSkeleton } from "@/components/ChartSkeleton";
import { useChartTheme } from "@/lib/useChartTheme";
import { useMounted } from "@/lib/useMounted";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import type { AccountDTO } from "@/lib/queries";
import { StrategyButton } from "./StrategyButton";
import { StatCard } from "@/components/ui-bits";
import { TermsRow } from "./TermsRow";
import { PayoffOrderList } from "./PayoffOrderList";
import { payoffDateLabel } from "./debt-utils";

export function DebtPlanner({ debts }: { debts: AccountDTO[] }) {
  const [strategy, setStrategy] = useState<Strategy>("avalanche");
  const [extra, setExtra] = useState("0");
  const [cascade, setCascade] = useState(true);
  const theme = useChartTheme();
  const reducedMotion = usePrefersReducedMotion();
  const mounted = useMounted();
  // Per-account inclusion - all enabled by default.
  const [included, setIncluded] = useState<Set<string>>(() => new Set(debts.map((d) => d.id)));

  const toggleIncluded = (id: string) => setIncluded((prev) => toggleInSet(prev, id));

  // Debts missing the APR / minimum payment can't be simulated yet.
  const ready = useMemo(() => debts.filter((d) => d.interestRate !== null && d.minimumPayment !== null), [debts]);
  const needsTerms = useMemo(() => debts.filter((d) => d.interestRate === null || d.minimumPayment === null), [debts]);

  // Only include accounts the user has checked.
  const activeReady = useMemo(() => ready.filter((d) => included.has(d.id)), [ready, included]);

  const inputs = useMemo<DebtInput[]>(
    () => activeReady.map((d) => ({
      id: d.id,
      name: d.name,
      color: d.color,
      balance: d.currentBalance,
      apr: d.interestRate ?? 0,
      minPayment: d.minimumPayment ?? 0,
    })),
    [activeReady],
  );

  const extraNum = Math.max(0, Number(extra.replace(/[^0-9.]/g, "")) || 0);

  const plan = useMemo(() => simulatePayoff(inputs, strategy, extraNum, cascade), [inputs, strategy, extraNum, cascade]);
  // Baseline = minimums only (no extra), for the savings comparison.
  const baseline = useMemo(() => simulatePayoff(inputs, strategy, 0, cascade), [inputs, strategy, cascade]);

  const totalBalance = activeReady.reduce((s, d) => s + d.currentBalance, 0);
  const totalMin = activeReady.reduce((s, d) => s + (d.minimumPayment ?? 0), 0);

  const interestSaved = baseline.feasible && plan.feasible ? baseline.totalInterest - plan.totalInterest : 0;
  const monthsSaved = baseline.feasible && plan.feasible ? baseline.totalMonths - plan.totalMonths : 0;

  const chartData = plan.months.map((m) => ({ month: m.index, balance: m.totalBalance }));

  return (
    <div className="space-y-5">
      {needsTerms.length > 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium text-warning">
            <AlertTriangle size={15} /> Add terms to include these in the plan
          </p>
          <div className="space-y-2">
            {needsTerms.map((d) => (
              <TermsRow key={d.id} debt={d} />
            ))}
          </div>
        </div>
      )}

      {ready.length === 0 ? (
        <p className="card px-4 py-8 text-center text-sm text-muted">
          Set the interest rate and minimum payment on at least one debt to see your payoff plan.
        </p>
      ) : (
        <>
          {/* Account selector */}
          <div className="card p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Include in calculation</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {ready.map((d) => (
                <label key={d.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={included.has(d.id)}
                    onChange={() => toggleIncluded(d.id)}
                  />
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    {d.name}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {activeReady.length === 0 ? (
            <p className="card px-4 py-8 text-center text-sm text-muted">
              Select at least one account to see the payoff plan.
            </p>
          ) : (
          <>
          {/* Controls */}
          <div className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Strategy</p>
                <div className="flex gap-1 rounded-lg bg-surface2 p-1">
                  <StrategyButton
                    active={strategy === "avalanche"}
                    onClick={() => setStrategy("avalanche")}
                    icon={<Mountain size={14} />}
                    label="Avalanche"
                    hint="Highest rate first"
                  />
                  <StrategyButton
                    active={strategy === "snowball"}
                    onClick={() => setStrategy("snowball")}
                    icon={<Snowflake size={14} />}
                    label="Snowball"
                    hint="Smallest balance first"
                  />
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Extra monthly payment</p>
                <div className="relative w-40">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
                  <input
                    inputMode="decimal"
                    value={extra}
                    onChange={(e) => setExtra(e.target.value)}
                    className="input h-9 w-full pl-6 text-sm tabular-nums"
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted">On top of {formatUSD(totalMin)} in minimums</p>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Payment rollover</p>
                <button
                  onClick={() => setCascade((c) => !c)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${cascade ? "bg-brand text-brand-fg" : "bg-surface2 text-muted hover:text-text"}`}
                >
                  <ArrowRight size={14} />
                  {cascade ? "On" : "Off"}
                </button>
                <p className="mt-1 text-[11px] text-muted">
                  {cascade ? "Freed minimums roll onto next debt" : "Freed minimums leave the pool"}
                </p>
              </div>
            </div>
          </div>

          {!plan.feasible ? (
            <div className="rounded-xl border border-expense/40 bg-expense/5 px-4 py-3 text-sm text-expense">
              {plan.reason}
            </div>
          ) : (
            <>
              {/* Summary stats */}
              <div className="grid gap-3 sm:grid-cols-3">
                <StatCard label="Debt-free in" value={monthsToLabel(plan.totalMonths)} tone="brand" hint={payoffDateLabel(plan.totalMonths)} />
                <StatCard label="Total interest" value={formatUSD(plan.totalInterest)} tone="expense" hint={`on ${formatUSD(totalBalance)} of debt`} />
                <StatCard
                  label="Saved vs. minimums"
                  value={interestSaved > 0.5 ? formatUSD(interestSaved) : "-"}
                  tone="income"
                  hint={monthsSaved > 0 ? `${monthsToLabel(monthsSaved)} sooner` : "Add an extra payment to save"}
                />
              </div>

              {/* Balance-over-time chart */}
              <div className="card p-4">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <TrendingDown size={16} className="text-brand" /> Balance over time
                </h2>
                {!mounted ? <ChartSkeleton height={220} /> : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData} margin={{ left: 8, right: 8, top: 8 }}>
                    <CartesianGrid stroke={theme.grid} vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: theme.axis, fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(m) => (m % 12 === 0 ? `${m / 12}y` : "")}
                    />
                    <YAxis tick={{ fill: theme.axis, fontSize: 12 }} tickLine={false} axisLine={false} width={60} tickFormatter={(v) => formatUSDWhole(v)} />
                    <Tooltip
                      contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }}
                      labelFormatter={(m) => `Month ${m}`}
                      formatter={(v) => [formatUSD(Number(v)), "Balance"]}
                    />
                    <Line type="monotone" dataKey="balance" stroke={theme.brand} strokeWidth={2.5} dot={false} isAnimationActive={!reducedMotion} />
                  </LineChart>
                </ResponsiveContainer>
                )}
              </div>

              {/* Per-debt payoff order */}
              <PayoffOrderList
                perDebt={plan.perDebt}
                accounts={activeReady}
                cascade={cascade}
                extraNum={extraNum}
                strategy={strategy}
              />
            </>
          )}
          </>
          )}
        </>
      )}
    </div>
  );
}
