"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { TrendingDown, Snowflake, Mountain, Check, Loader2, AlertTriangle, Pencil, ArrowRight } from "lucide-react";
import { formatUSD, formatUSDWhole } from "@/lib/money";
import { simulatePayoff, monthsToLabel, type Strategy, type DebtInput } from "@/lib/debt-payoff";
import { updateDebtTermsAction } from "@/actions/accounts";
import type { AccountDTO } from "@/lib/queries";

export function DebtPlanner({ debts }: { debts: AccountDTO[] }) {
  const [strategy, setStrategy] = useState<Strategy>("avalanche");
  const [extra, setExtra] = useState("0");
  const [cascade, setCascade] = useState(true);
  // Per-account inclusion — all enabled by default.
  const [included, setIncluded] = useState<Set<string>>(() => new Set(debts.map((d) => d.id)));

  const toggleIncluded = (id: string) =>
    setIncluded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Debts missing the APR / minimum payment can't be simulated yet.
  const ready = debts.filter((d) => d.interestRate !== null && d.minimumPayment !== null);
  const needsTerms = debts.filter((d) => d.interestRate === null || d.minimumPayment === null);

  // Only include accounts the user has checked.
  const activeReady = ready.filter((d) => included.has(d.id));

  const inputs: DebtInput[] = activeReady.map((d) => ({
    id: d.id,
    name: d.name,
    color: d.color,
    balance: d.currentBalance,
    apr: d.interestRate ?? 0,
    minPayment: d.minimumPayment ?? 0,
  }));

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
                <StatBox label="Debt-free in" value={monthsToLabel(plan.totalMonths)} tone="brand" hint={payoffDateLabel(plan.totalMonths)} />
                <StatBox label="Total interest" value={formatUSD(plan.totalInterest)} tone="expense" hint={`on ${formatUSD(totalBalance)} of debt`} />
                <StatBox
                  label="Saved vs. minimums"
                  value={interestSaved > 0.5 ? formatUSD(interestSaved) : "—"}
                  tone="income"
                  hint={monthsSaved > 0 ? `${monthsToLabel(monthsSaved)} sooner` : "Add an extra payment to save"}
                />
              </div>

              {/* Balance-over-time chart */}
              <div className="card p-4">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <TrendingDown size={16} className="text-brand" /> Balance over time
                </h2>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData} margin={{ left: 8, right: 8, top: 8 }}>
                    <CartesianGrid stroke="rgba(148,163,184,0.2)" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: "#94a3b8", fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(m) => (m % 12 === 0 ? `${m / 12}y` : "")}
                    />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} tickLine={false} axisLine={false} width={60} tickFormatter={(v) => formatUSDWhole(v)} />
                    <Tooltip
                      contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }}
                      labelFormatter={(m) => `Month ${m}`}
                      formatter={(v) => [formatUSD(Number(v)), "Balance"]}
                    />
                    <Line type="monotone" dataKey="balance" stroke="#4f46e5" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Per-debt payoff order */}
              <div className="card overflow-hidden">
                <div className="border-b border-line px-4 py-3">
                  <h2 className="text-sm font-semibold">Payoff order ({strategy === "avalanche" ? "highest rate first" : "smallest balance first"})</h2>
                </div>
                <ul className="divide-y divide-line">
                  {(() => {
                    const sorted = [...plan.perDebt].sort((a, b) => a.monthsToPayoff - b.monthsToPayoff);
                    // Running total of freed minimums available to cascade onto each subsequent debt.
                    let freedSoFar = 0;
                    return sorted.map((d, i) => {
                      const acct = activeReady.find((r) => r.id === d.id);
                      const minPayment = acct?.minimumPayment ?? 0;
                      const rolledIn = cascade ? freedSoFar : 0;
                      const isLast = i === sorted.length - 1;
                      // Total recommended monthly payment for this debt during its focus phase:
                      // minimum + extra (which includes any cascade from paid-off debts).
                      const focusPayment = minPayment + extraNum + rolledIn;
                      const extraAllocated = extraNum + rolledIn;
                      freedSoFar += minPayment;
                      return (
                        <li key={d.id}>
                          <div className="flex items-center gap-3 px-4 py-3">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums" style={{ backgroundColor: `${d.color}22`, color: d.color }}>
                              {i + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{d.name}</p>
                              <p className="text-xs text-muted">
                                {formatUSD(acct?.currentBalance ?? 0)} · {acct?.interestRate}% APR · {formatUSD(d.totalInterest)} interest
                              </p>
                              {/* Recommended payment breakdown for this debt's focus phase */}
                              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
                                <span className="font-medium text-text">
                                  {i === 0 ? "Pay now:" : `Pay when focus:`}
                                </span>
                                <span className="font-semibold text-brand">{formatUSD(focusPayment)}/mo</span>
                                <span className="text-muted">
                                  ({formatUSD(minPayment)} min
                                  {extraAllocated > 0 && (
                                    <> + <span className="text-income">{formatUSD(extraAllocated)} extra{rolledIn > 0 ? ` (incl. ${formatUSD(rolledIn)} freed)` : ""}</span></>
                                  )}
                                  )
                                </span>
                              </p>
                            </div>
                            <span className="shrink-0 text-sm font-semibold text-brand">{monthsToLabel(d.monthsToPayoff)}</span>
                          </div>
                          {!isLast && (
                            <div className="flex items-center gap-1.5 border-t border-dashed border-line/60 px-4 py-1.5 text-[11px] text-muted">
                              <ArrowRight size={10} className="text-brand" />
                              <span>
                                {cascade
                                  ? <><span className="font-medium text-brand">{formatUSD(minPayment)}/mo</span> freed — rolls onto next debt</>
                                  : <><span className="font-medium text-muted">{formatUSD(minPayment)}/mo</span> freed — rollover is off, leaves the pool</>
                                }
                              </span>
                            </div>
                          )}
                        </li>
                      );
                    });
                  })()}
                </ul>
              </div>
            </>
          )}
          </>
          )}
        </>
      )}
    </div>
  );
}

function StrategyButton({ active, onClick, icon, label, hint }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-start rounded-md px-3 py-1.5 text-left transition-colors ${active ? "bg-surface shadow-sm" : "text-muted hover:text-text"}`}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">{icon} {label}</span>
      <span className="text-[10px] text-muted">{hint}</span>
    </button>
  );
}

function StatBox({ label, value, tone, hint }: { label: string; value: string; tone: "brand" | "income" | "expense"; hint: string }) {
  const c = tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : "text-brand";
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${c}`}>{value}</p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
    </div>
  );
}

function TermsRow({ debt }: { debt: AccountDTO }) {
  const [editing, setEditing] = useState(true);
  const [apr, setApr] = useState(debt.interestRate !== null ? String(debt.interestRate) : "");
  const [min, setMin] = useState(debt.minimumPayment !== null ? String(debt.minimumPayment) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setError(null);
      const res = await updateDebtTermsAction(debt.id, { interestRate: apr, minimumPayment: min });
      if (!res.ok) return setError(res.error);
      setEditing(false);
    });

  if (!editing) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm">
        <span className="flex-1 font-medium">{debt.name}</span>
        <span className="text-muted">{apr}% · {formatUSD(Number(min))}/mo</span>
        <button onClick={() => setEditing(true)} className="btn-ghost h-7 w-7 p-0!" title="Edit"><Pencil size={13} /></button>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-surface px-3 py-2">
      <div className="flex flex-wrap items-end gap-2">
        <span className="min-w-24 flex-1 text-sm font-medium">{debt.name}</span>
        <label className="text-[11px] text-muted">
          APR %
          <input value={apr} onChange={(e) => setApr(e.target.value)} inputMode="decimal" className="input h-8 w-20 text-sm" placeholder="19.99" />
        </label>
        <label className="text-[11px] text-muted">
          Min / mo
          <div className="relative w-24">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">$</span>
            <input value={min} onChange={(e) => setMin(e.target.value)} inputMode="decimal" className="input h-8 w-full pl-5 text-sm" placeholder="35" />
          </div>
        </label>
        <button onClick={save} disabled={pending || !apr || !min} className="btn-primary h-8">
          {pending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-expense">{error}</p>}
    </div>
  );
}

function payoffDateLabel(months: number): string {
  if (months <= 0) return "";
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return `by ${d.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`;
}
