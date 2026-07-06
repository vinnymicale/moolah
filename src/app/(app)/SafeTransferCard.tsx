"use client";

import { useState, useTransition } from "react";
import { Sparkles, ChevronDown, CheckCircle2, Loader2, Info, ArrowRight } from "lucide-react";
import { contributeGoalAction } from "@/actions/goals";
import { formatUSD } from "@/lib/money";
import { localMonthEndLabel } from "@/lib/dates";
import { CategoryIcon } from "@/components/CategoryIcon";
import { usePersistentState } from "@/lib/usePersistentState";
import type { SafeTransferDTO, SavingsGoalDTO } from "@/lib/queries";
import { toneTextClass, type Tone } from "@/components/ui-bits";

// localStorage key remembering whether the user collapsed the card.
const COLLAPSE_KEY = "safe-transfer-collapsed";

export function SafeTransferCard({
  data,
  goals,
}: {
  data: SafeTransferDTO;
  goals: SavingsGoalDTO[];
}) {
  const [collapsed, setCollapsed] = usePersistentState(COLLAPSE_KEY, false);
  const [amount, setAmount] = useState(String(data.safeAmount));
  const [goalId, setGoalId] = useState(goals[0]?.id ?? "");
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleCollapsed = () => setCollapsed(!collapsed);

  const allocate = () => {
    const parsed = parseFloat(amount);
    if (!goalId || isNaN(parsed) || parsed <= 0) return;
    setError(null);
    startTransition(async () => {
      const result = await contributeGoalAction(goalId, parsed);
      if (result.ok) {
        setDone(true);
        setTimeout(() => setDone(false), 4000);
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  };

  const parsedAmount = parseFloat(amount);
  const amountValid = !isNaN(parsedAmount) && parsedAmount > 0;
  const selectedGoal = goals.find((g) => g.id === goalId);

  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-brand/30 bg-gradient-to-br from-brand/5 to-brand/10">
      {/* Header - click to collapse/expand (always visible) */}
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-brand/5"
        title={collapsed ? "Expand" : "Collapse"}
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand">
            <Sparkles size={18} />
          </span>
          <div>
            <p className="font-semibold text-text">
              You can safely move{" "}
              <span className="text-brand">{formatUSD(data.safeAmount)}</span> out of checking
            </p>
            <p className="text-xs text-muted">
              After this month&apos;s remaining bills and next month&apos;s typical start ·{" "}
              {data.daysLeft === 0 ? "last day of the month" : `${data.daysLeft} day${data.daysLeft === 1 ? "" : "s"} left`}
            </p>
          </div>
        </div>
        <ChevronDown
          size={18}
          aria-hidden
          className={`mt-1 shrink-0 text-muted transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`}
        />
      </button>
      {!collapsed && (
        <>
      {/* end header */}

      {/* Breakdown toggle */}
      <div className="border-t border-brand/15">
        <button
          onClick={() => setShowBreakdown((b) => !b)}
          aria-expanded={showBreakdown}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-brand/5 hover:text-text"
        >
          <Info size={15} className="shrink-0" />
          <span className="flex-1 text-left">How is this calculated?</span>
          <ChevronDown size={18} className={`shrink-0 transition-transform duration-200 ${showBreakdown ? "rotate-180" : ""}`} />
        </button>

        {showBreakdown && (
          <div className="px-4 pb-3">
            <div className="space-y-2.5 rounded-lg bg-surface/70 px-3 py-3 text-xs text-muted">
            <p className="leading-snug">
              We start with the cash in your checking, subtract what you still owe this month,
              then hold back a cushion for the first half of next month based on your history.
              Only transactions from liquid bank accounts feed the historical figures - individual
              credit card charges are excluded.
            </p>

            {/* Step 1 - checking balance */}
            <div className="border-t border-line pt-2">
              <Row
                label={`Checking balance${data.checkingCount > 1 ? ` (${data.checkingCount} accounts)` : ""}`}
                value={formatUSD(data.anchorBalance)}
                bold
              />
              <p className="mt-0.5 text-[11px] leading-snug">
                {data.checkingCount > 1
                  ? `All ${data.checkingCount} checking accounts are summed together. Savings and cash accounts are not included in this starting balance.`
                  : "Savings and cash accounts are not included - only your checking balance is used as the starting point."}
              </p>
            </div>

            {/* Step 2 - remaining bills */}
            <div className="border-t border-line pt-2">
              <Row label="- Remaining bills this month" value={`-${formatUSD(data.remainingExpenses)}`} tone="expense" bold />
              <div className="mt-1 space-y-0.5 pl-3">
                <Row
                  label={`Recurring bills due (${data.remainingRecurringCount})`}
                  value={`-${formatUSD(data.remainingRecurring)}`}
                />
                <Row
                  label={`Other expected payments (${data.remainingOneOffCount})`}
                  value={`-${formatUSD(data.remainingOneOff)}`}
                />
              </div>
              <p className="mt-1 text-[11px] leading-snug">
                Recurring rules scheduled between today and {localMonthEndLabel()}, plus any
                uncleared one-off expenses you&apos;ve already entered.
              </p>
            </div>

            {/* Step 3 - upcoming credit card statement payments */}
            {data.upcomingCCDue > 0 && (
              <div className="border-t border-line pt-2">
                <Row
                  label={`- Credit card payments due (${data.upcomingCCDueCount})`}
                  value={`-${formatUSD(data.upcomingCCDue)}`}
                  tone="expense"
                  bold
                />
                <p className="mt-1 text-[11px] leading-snug">
                  Statement balances for the credit card due dates showing on your calendar.
                  We hold these back in full so the money is there when the payment posts.
                </p>
              </div>
            )}

            {/* Step 4 - next-month buffer */}
            <div className="border-t border-line pt-2">
              <Row label="- Next-month buffer" value={`-${formatUSD(data.nextMonthBuffer)}`} tone="expense" bold />
              <div className="mt-1 space-y-0.5 pl-3">
                <Row
                  label={
                    data.bufferMonthsUsed > 0
                      ? `Avg. early-month spend (${data.bufferMonthsUsed}-mo)`
                      : "Avg. early-month spend"
                  }
                  value={formatUSD(data.earlyMonthAvg)}
                />
                <Row label={`Safety cushion (+${data.bufferCushionPct}%)`} value={`+${formatUSD(data.nextMonthBuffer - data.earlyMonthAvg)}`} />
              </div>
              <p className="mt-1 text-[11px] leading-snug">
                Your typical bank spending in the first 14 days of a month, averaged over the
                last {data.bufferMonthsUsed > 0 ? `${data.bufferMonthsUsed} month${data.bufferMonthsUsed === 1 ? "" : "s"}` : "few months"},
                plus a {data.bufferCushionPct}% margin for the unexpected. This covers next
                month&apos;s rent, statement payments and routine spending before your next paycheck lands.
              </p>
            </div>

            {/* Result */}
            <div className="border-t border-line pt-2">
              {data.rawSafe !== data.safeAmount && (
                <Row label="= Available" value={formatUSD(data.rawSafe)} />
              )}
              <Row label="Safe to move (rounded down to $50)" value={formatUSD(data.safeAmount)} tone="income" bold />
            </div>

            {data.totalCCBalance > 0 && (
              <p className="border-t border-line pt-2 text-[11px] leading-snug">
                Heads up: <span className="font-medium text-text">{formatUSD(data.totalCCBalance)}</span> is
                outstanding on your credit cards.
                {data.upcomingCCDue > 0
                  ? " We hold back the statement payments due soon (above); the rest isn't subtracted, since you'll pay it on a later statement that the next-month buffer already covers."
                  : " We don't subtract it here because the statement payment shows up in your bank history and is already baked into the next-month buffer - subtracting both would double-count it."}
              </p>
            )}
          </div>
          </div>
        )}
      </div>

      {/* Action area */}
      <div className="border-t border-brand/15 px-4 py-3">
        {done ? (
          <div className="flex items-center gap-2 text-sm text-income">
            <CheckCircle2 size={16} />
            <span>
              {formatUSD(parsedAmount)} added to{" "}
              <strong>{selectedGoal?.name ?? "goal"}</strong>. Nice work!
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {/* Amount input */}
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
              <input
                type="number"
                min="1"
                step="50"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input h-9 w-28 pl-6 text-sm money"
                aria-label="Amount to allocate"
              />
            </div>

            {goals.length > 0 ? (
              <>
                <span className="text-sm text-muted">→</span>
                {/* Goal picker */}
                <select
                  value={goalId}
                  onChange={(e) => setGoalId(e.target.value)}
                  className="input h-9 w-auto text-sm"
                >
                  {goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>

                {selectedGoal && (
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded"
                      style={{ backgroundColor: `${selectedGoal.color}22`, color: selectedGoal.color }}
                    >
                      <CategoryIcon name={selectedGoal.icon} size={11} />
                    </span>
                    {formatUSD(selectedGoal.currentAmount)} / {formatUSD(selectedGoal.targetAmount)}
                  </span>
                )}

                <button
                  onClick={allocate}
                  disabled={pending || !amountValid || !goalId}
                  className="btn-primary h-9"
                >
                  {pending ? <Loader2 size={14} className="animate-spin" /> : null}
                  Contribute to goal
                </button>
              </>
            ) : (
              <span className="text-sm text-muted">
                Move this amount out of checking toward your savings or goals.{" "}
                <a href="/goals" className="text-brand hover:underline">Set up a goal</a> to track it here.
              </span>
            )}

            {error && <p className="w-full text-xs text-expense">{error}</p>}

            {/* After-transfer balance preview */}
            {amountValid && parsedAmount > 0 && (
              <div className="mt-1 w-full rounded-lg border border-line bg-surface/70 px-3 py-2">
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                  After moving {formatUSD(parsedAmount)}
                </p>
                <div className="space-y-1 text-xs">
                  <BalanceShift
                    label={`Checking${data.checkingCount > 1 ? ` (${data.checkingCount})` : ""}`}
                    before={data.anchorBalance}
                    after={data.anchorBalance - parsedAmount}
                    negative={data.anchorBalance - parsedAmount < 0}
                  />
                </div>
                {data.anchorBalance - parsedAmount < 0 && (
                  <p className="mt-1.5 text-[11px] leading-snug text-expense">
                    This is more than your checking balance - you&apos;d overdraw the account.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}

function BalanceShift({
  label,
  before,
  after,
  negative,
}: {
  label: string;
  before: number;
  after: number;
  negative?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-1.5 money">
        <span className="text-muted line-through decoration-muted/40">{formatUSD(before)}</span>
        <ArrowRight size={11} className="text-muted" />
        <span className={`font-semibold ${negative ? "text-expense" : "text-text"}`}>{formatUSD(after)}</span>
      </span>
    </div>
  );
}

function Row({
  label,
  value,
  tone = "default",
  bold,
}: {
  label: string;
  value: string;
  tone?: Tone;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>{label}</span>
      <span className={`money ${toneTextClass(tone)} ${bold ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
