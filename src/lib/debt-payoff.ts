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
/**
 * @param cascade When true (default), the minimum payment freed when a debt is
 * paid off is rolled onto the next focus debt. When false each debt is paid
 * with its own minimum only; freed payments are not redistributed.
 */
export function simulatePayoff(debts: DebtInput[], strategy: Strategy, extra: number, cascade = true): PayoffPlan {
  const active = debts
    .filter((d) => d.balance > 0)
    .map((d) => ({ ...d, remaining: d.balance, interestPaid: 0, paidOffMonth: -1, prevRemaining: d.balance }));

  const startingBalance = active.reduce((s, d) => s + d.balance, 0);

  if (active.length === 0) {
    return { feasible: true, months: [], perDebt: [], totalMonths: 0, totalInterest: 0, startingBalance: 0 };
  }

  // Gap check: if any debt's minimum doesn't cover its monthly interest, the
  // extra payment must cover the combined shortfall. If it does, the simulation
  // automatically routes the gap amount to those debts before applying the rest
  // to the strategy focus debt - so the user doesn't need to change their minimums.
  const firstMonthGaps = active.map((d) => Math.max(0, (d.balance * d.apr) / 100 / 12 - d.minPayment));
  const totalGap = firstMonthGaps.reduce((s, g) => s + g, 0);
  if (totalGap > extra) {
    const underwater = active
      .map((d, i) => firstMonthGaps[i] > 0 ? `"${d.name}" (${fmt(firstMonthGaps[i])}/mo short)` : null)
      .filter((s): s is string => s !== null);
    const needed = Math.ceil(totalGap - extra);
    return {
      feasible: false,
      reason: `${underwater.join(", ")} - minimum payment${underwater.length > 1 ? "s don't" : " doesn't"} cover monthly interest. Add at least ${fmt(needed)}/mo more to the extra payment and this will be handled automatically.`,
      months: [],
      perDebt: [],
      totalMonths: 0,
      totalInterest: 0,
      startingBalance,
    };
  }

  // Total-payment feasibility: combined minimums + extra must exceed combined interest.
  const totalMin = active.reduce((s, d) => s + d.minPayment, 0);
  const firstMonthInterest = active.reduce((s, d) => s + (d.remaining * d.apr) / 100 / 12, 0);
  if (totalMin + extra <= firstMonthInterest) {
    return {
      feasible: false,
      reason: "Your total monthly payment doesn't cover the interest - the balance would grow. Increase the extra payment.",
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

    // Snapshot balance before interest so we can measure overhang in step 4a.
    for (const d of active) d.prevRemaining = d.remaining;

    // 1. Accrue interest.
    for (const d of active) {
      if (d.remaining <= 0.005) continue;
      const interest = (d.remaining * d.apr) / 100 / 12;
      d.remaining += interest;
      d.interestPaid += interest;
      monthInterest += interest;
    }

    // 2. Budget this month. With cascade=true, freed minimums from paid-off
    //    debts roll onto the focus debt automatically. With cascade=false, only
    //    still-active minimums are counted so freed money leaves the pool.
    const activeMins = active.reduce((s, d) => d.remaining > 0.005 ? s + d.minPayment : s, 0);
    let budget = extra + (cascade ? active.reduce((s, d) => s + d.minPayment, 0) : activeMins);

    // 3. Pay minimums first (capped at remaining).
    for (const d of active) {
      if (d.remaining <= 0.005) continue;
      const pay = Math.min(d.minPayment, d.remaining);
      d.remaining -= pay;
      budget -= pay;
    }

    // 4a. Automatically cover any interest overhang on underwater debts from
    //     the extra budget before routing the remainder to the strategy focus.
    //     This lets the user's extra payment absorb gaps without needing to
    //     update individual account minimums.
    for (const d of active) {
      if (d.remaining <= 0.005 || budget <= 0.005) continue;
      const overhang = d.remaining - d.prevRemaining; // positive when min < interest
      if (overhang > 0.005) {
        const pay = Math.min(overhang, budget, d.remaining);
        d.remaining -= pay;
        budget -= pay;
      }
    }

    // 4b. Throw the rest at the focus debt(s) in strategy order.
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

  // If the loop hit the 100-year cap without clearing all debts, the payments
  // are too low to ever reach zero. Return infeasible instead of garbage numbers.
  if (month >= MAX_MONTHS && active.some((d) => d.remaining > 0.005)) {
    const struggling = active
      .filter((d) => d.remaining > d.balance)
      .map((d) => `"${d.name}"`);
    const detail = struggling.length > 0
      ? ` (${struggling.join(", ")} grew instead of shrinking)`
      : "";
    return {
      feasible: false,
      reason: `Payoff would take over 100 years at current payment levels${detail}. Increase the minimum payment or add an extra monthly payment.`,
      months: [],
      perDebt: [],
      totalMonths: 0,
      totalInterest: 0,
      startingBalance,
    };
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

function fmt(n: number): string {
  return `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
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
