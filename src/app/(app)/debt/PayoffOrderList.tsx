import { ArrowRight } from "lucide-react";
import { formatUSD } from "@/lib/money";
import { monthsToLabel, type DebtResult, type Strategy } from "@/lib/debt-payoff";
import type { AccountDTO } from "@/lib/queries";

interface PayoffRow {
  id: string;
  color: string;
  name: string;
  currentBalance: number;
  interestRate: number | null;
  totalInterest: number;
  monthsToPayoff: number;
  minPayment: number;
  /** Recommended monthly payment while this debt is the focus. */
  focusPayment: number;
  /** Extra on top of the minimum, including any cascaded amount. */
  extraAllocated: number;
  /** Freed minimums cascaded in from already-paid debts (0 when rollover is off). */
  rolledIn: number;
}

// Threads the running "freed minimums" total through the payoff order so each
// debt shows the extra it inherits once earlier debts are cleared.
function computePayoffRows(
  perDebt: DebtResult[],
  accounts: AccountDTO[],
  cascade: boolean,
  extraNum: number,
): PayoffRow[] {
  const sorted = [...perDebt].sort((a, b) => a.monthsToPayoff - b.monthsToPayoff);
  let freedSoFar = 0;
  return sorted.map((d) => {
    const acct = accounts.find((r) => r.id === d.id);
    const minPayment = acct?.minimumPayment ?? 0;
    const rolledIn = cascade ? freedSoFar : 0;
    freedSoFar += minPayment;
    return {
      id: d.id,
      color: d.color,
      name: d.name,
      currentBalance: acct?.currentBalance ?? 0,
      interestRate: acct?.interestRate ?? null,
      totalInterest: d.totalInterest,
      monthsToPayoff: d.monthsToPayoff,
      minPayment,
      focusPayment: minPayment + extraNum + rolledIn,
      extraAllocated: extraNum + rolledIn,
      rolledIn,
    };
  });
}

export function PayoffOrderList({
  perDebt,
  accounts,
  cascade,
  extraNum,
  strategy,
}: {
  perDebt: DebtResult[];
  accounts: AccountDTO[];
  cascade: boolean;
  extraNum: number;
  strategy: Strategy;
}) {
  const rows = computePayoffRows(perDebt, accounts, cascade, extraNum);

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">
          Payoff order ({strategy === "avalanche" ? "highest rate first" : "smallest balance first"})
        </h2>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((row, i) => {
          const isLast = i === rows.length - 1;
          return (
            <li key={row.id}>
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums" style={{ backgroundColor: `${row.color}22`, color: row.color }}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.name}</p>
                  <p className="text-xs text-muted">
                    {formatUSD(row.currentBalance)} · {row.interestRate}% APR · {formatUSD(row.totalInterest)} interest
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
                    <span className="font-medium text-text">
                      {i === 0 ? "Pay now:" : "Pay when focus:"}
                    </span>
                    <span className="font-semibold text-brand">{formatUSD(row.focusPayment)}/mo</span>
                    <span className="text-muted">
                      ({formatUSD(row.minPayment)} min
                      {row.extraAllocated > 0 && (
                        <> + <span className="text-income">{formatUSD(row.extraAllocated)} extra{row.rolledIn > 0 ? ` (incl. ${formatUSD(row.rolledIn)} freed)` : ""}</span></>
                      )}
                      )
                    </span>
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold text-brand">{monthsToLabel(row.monthsToPayoff)}</span>
              </div>
              {!isLast && (
                <div className="flex items-center gap-1.5 border-t border-dashed border-line/60 px-4 py-1.5 text-[11px] text-muted">
                  <ArrowRight size={10} className="text-brand" />
                  <span>
                    {cascade
                      ? <><span className="font-medium text-brand">{formatUSD(row.minPayment)}/mo</span> freed - rolls onto next debt</>
                      : <><span className="font-medium text-muted">{formatUSD(row.minPayment)}/mo</span> freed - rollover is off, leaves the pool</>
                    }
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
