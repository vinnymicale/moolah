// Debt payoff simulation. Models month-by-month amortisation for a set of
// debts under either the avalanche (highest APR first) or snowball (smallest
// balance first) strategy, with an optional extra monthly payment rolled onto
// the focus debt and cascaded as debts are cleared.

export interface DebtInput {
  id: string;
  name: string;
  color: string;
  balance: number;
  /** Annual percentage rate, e.g. 19.99. */
  apr: number;
  /** Minimum monthly payment. */
  minPayment: number;
}

export type Strategy = "avalanche" | "snowball";

export interface PayoffMonth {
  /** 0-based month index from now. */
  index: number;
  /** Total balance remaining across all debts at the end of this month. */
  totalBalance: number;
  /** Interest accrued across all debts this month. */
  interest: number;
}

export interface DebtResult {
  id: string;
  name: string;
  color: string;
  /** Months until this debt hits zero. */
  monthsToPayoff: number;
  /** Total interest paid on this debt over its life. */
  totalInterest: number;
}

export interface PayoffPlan {
  feasible: boolean;
  /** Set when infeasible: a debt whose min payment can't cover its interest. */
  reason?: string;
  months: PayoffMonth[];
  perDebt: DebtResult[];
  totalMonths: number;
  totalInterest: number;
  /** Sum of all starting balances. */
  startingBalance: number;
}

const MAX_MONTHS = 1200; // 100-year safety bound

/**
 * Simulate paying off `debts` using `strategy`, applying `extra` dollars on top
 * of the combined minimums each month. The extra (plus freed-up minimums from
 * cleared debts) always targets the current focus debt per the strategy.
 */
export function simulatePayoff(debts: DebtInput[], strategy: Strategy, extra: number): PayoffPlan {
  const active = debts
    .filter((d) => d.balance > 0)
    .map((d) => ({ ...d, remaining: d.balance, interestPaid: 0, paidOffMonth: -1 }));

  const startingBalance = active.reduce((s, d) => s + d.balance, 0);

  if (active.length === 0) {
    return { feasible: true, months: [], perDebt: [], totalMonths: 0, totalInterest: 0, startingBalance: 0 };
  }

  // Feasibility check: each debt's minimum must exceed its first month's interest,
  // otherwise the balance never shrinks (unless extra eventually covers it).
  const totalMin = active.reduce((s, d) => s + d.minPayment, 0);
  const firstMonthInterest = active.reduce((s, d) => s + (d.remaining * d.apr) / 100 / 12, 0);
  if (totalMin + extra <= firstMonthInterest) {
    return {
      feasible: false,
      reason: "Your total monthly payment doesn't cover the interest — the balance would grow. Increase the extra payment.",
      months: [],
      perDebt: [],
      totalMonths: 0,
      totalInterest: 0,
      startingBalance,
    };
  }

  const order = () =>
    [...active]
      .filter((d) => d.remaining > 0.005)
      .sort((a, b) => (strategy === "avalanche" ? b.apr - a.apr : a.remaining - b.remaining));

  const months: PayoffMonth[] = [];
  let month = 0;

  while (active.some((d) => d.remaining > 0.005) && month < MAX_MONTHS) {
    let monthInterest = 0;

    // 1. Accrue interest.
    for (const d of active) {
      if (d.remaining <= 0.005) continue;
      const interest = (d.remaining * d.apr) / 100 / 12;
      d.remaining += interest;
      d.interestPaid += interest;
      monthInterest += interest;
    }

    // 2. Budget = extra + every debt's minimum. Minimums from already-cleared
    //    debts are never subtracted below, so they cascade onto the focus debt.
    let budget = extra + active.reduce((s, d) => s + d.minPayment, 0);

    // 3. Pay minimums first (capped at remaining).
    for (const d of active) {
      if (d.remaining <= 0.005) continue;
      const pay = Math.min(d.minPayment, d.remaining);
      d.remaining -= pay;
      budget -= pay;
    }

    // 4. Throw the rest at the focus debt(s) in strategy order.
    for (const d of order()) {
      if (budget <= 0.005) break;
      const pay = Math.min(budget, d.remaining);
      d.remaining -= pay;
      budget -= pay;
    }

    // 5. Record payoff month for any debt that just cleared.
    for (const d of active) {
      if (d.remaining <= 0.005 && d.paidOffMonth === -1) d.paidOffMonth = month + 1;
    }

    const totalBalance = active.reduce((s, d) => s + Math.max(0, d.remaining), 0);
    months.push({ index: month, totalBalance: round(totalBalance), interest: round(monthInterest) });
    month++;
  }

  const perDebt: DebtResult[] = active.map((d) => ({
    id: d.id,
    name: d.name,
    color: d.color,
    monthsToPayoff: d.paidOffMonth === -1 ? month : d.paidOffMonth,
    totalInterest: round(d.interestPaid),
  }));

  return {
    feasible: true,
    months,
    perDebt,
    totalMonths: month,
    totalInterest: round(active.reduce((s, d) => s + d.interestPaid, 0)),
    startingBalance: round(startingBalance),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Convert a month count into a friendly "2 yr 3 mo" label. */
export function monthsToLabel(months: number): string {
  if (months <= 0) return "Paid off";
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} mo`;
  if (m === 0) return `${y} yr`;
  return `${y} yr ${m} mo`;
}
