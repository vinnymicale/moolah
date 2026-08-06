// Loan amortization. Where the debt planner (lib/debt-payoff.ts) answers "which
// debt do I attack first", this answers the single-loan questions a mortgage or
// auto loan raises: what does the payment schedule look like, how much of each
// payment is interest, and what does overpaying actually save me.
//
// Everything here is pure and monthly-compounded, matching the payoff planner's
// convention of apr/100/12 per period.

import { parseISODay } from "./dates";

export interface LoanTerms {
  /** Current principal outstanding. */
  balance: number;
  /** Annual percentage rate, e.g. 6.25. */
  apr: number;
  /** Scheduled monthly payment (principal + interest). */
  payment: number;
}

export interface AmortizationRow {
  /** 1-based payment number. */
  period: number;
  /** Payment actually applied this month (the final one is usually smaller). */
  payment: number;
  interest: number;
  principal: number;
  /** Principal outstanding after this payment. */
  balance: number;
}

export interface AmortizationSchedule {
  feasible: boolean;
  /** Set when infeasible - the payment never clears the loan. */
  reason?: string;
  rows: AmortizationRow[];
  /** Number of payments until the balance hits zero. */
  months: number;
  totalInterest: number;
  totalPaid: number;
}

const MAX_PERIODS = 1200; // 100-year safety bound, same as the payoff planner.

/**
 * Build a full payment-by-payment schedule for a single loan. The last payment
 * is trimmed to whatever is actually owed rather than overshooting into a
 * negative balance.
 */
export function buildSchedule({ balance, apr, payment }: LoanTerms): AmortizationSchedule {
  if (!isFinite(balance) || !isFinite(apr) || !isFinite(payment)) {
    return infeasible("These loan terms aren't valid numbers.");
  }
  if (apr < 0) {
    return infeasible("The interest rate can't be negative.");
  }
  if (balance <= 0) {
    return { feasible: true, rows: [], months: 0, totalInterest: 0, totalPaid: 0 };
  }

  const monthlyRate = apr / 100 / 12;
  const firstInterest = balance * monthlyRate;

  if (payment <= firstInterest) {
    return infeasible(
      monthlyRate > 0
        ? `A ${fmt(payment)} payment doesn't cover the ${fmt(firstInterest)} of interest this loan accrues each month, so the balance would grow. Raise the payment above ${fmt(firstInterest)}.`
        : "The payment must be greater than zero.",
    );
  }

  const rows: AmortizationRow[] = [];
  let remaining = balance;
  let totalInterest = 0;
  let totalPaid = 0;

  while (remaining > 0.005 && rows.length < MAX_PERIODS) {
    const interest = remaining * monthlyRate;
    // Trim the final payment so it clears the balance exactly instead of
    // overpaying into the negative.
    const due = remaining + interest;
    const applied = Math.min(payment, due);
    const principal = applied - interest;

    remaining = due - applied;
    totalInterest += interest;
    totalPaid += applied;

    rows.push({
      period: rows.length + 1,
      payment: round(applied),
      interest: round(interest),
      principal: round(principal),
      balance: round(Math.max(0, remaining)),
    });
  }

  // A payment barely above the monthly interest clears the guard above but still
  // takes centuries to retire the balance. Report infeasible rather than a
  // 100-year schedule with six figures left owing.
  if (remaining > 0.005) {
    return infeasible(
      `A ${fmt(payment)} payment would take over 100 years to clear this balance. Raise the payment to pay it off in a reasonable term.`,
    );
  }

  return {
    feasible: true,
    rows,
    months: rows.length,
    totalInterest: round(totalInterest),
    totalPaid: round(totalPaid),
  };
}

function infeasible(reason: string): AmortizationSchedule {
  return { feasible: false, reason, rows: [], months: 0, totalInterest: 0, totalPaid: 0 };
}

/**
 * The level payment that retires `balance` over exactly `months` at `apr` - the
 * standard amortizing-loan formula. Used to derive a payment when the user
 * knows their term but hasn't recorded a monthly figure.
 *
 * Rounds to the cent by default, matching what a lender actually quotes. Note
 * that a cent-rounded payment leaves a sliver of principal outstanding each
 * month, so feeding it back into buildSchedule typically yields one extra stub
 * payment at the end - which is what really happens on a loan. Pass
 * `{ round: false }` for the exact figure when comparing against closed-form
 * reference math.
 */
export function paymentForTerm(
  balance: number,
  apr: number,
  months: number,
  opts: { round?: boolean } = {},
): number {
  if (!isFinite(balance) || !isFinite(apr) || !isFinite(months)) return 0;
  if (balance <= 0 || months <= 0 || apr < 0) return 0;
  const exact = (() => {
    const r = apr / 100 / 12;
    if (r === 0) return balance / months;
    const factor = Math.pow(1 + r, months);
    return (balance * r * factor) / (factor - 1);
  })();
  return opts.round === false ? exact : round(exact);
}

export interface ExtraPaymentComparison {
  /** The schedule as it stands today. */
  base: AmortizationSchedule;
  /** The schedule with `extra` added to every payment. */
  accelerated: AmortizationSchedule;
  /** Months shaved off the term. */
  monthsSaved: number;
  /** Interest avoided by paying extra. */
  interestSaved: number;
}

/**
 * Compare the current schedule against one with `extra` dollars added to every
 * monthly payment. This is the "should I overpay the mortgage" answer: it
 * reports the term reduction and lifetime interest avoided.
 */
export function compareExtraPayment(terms: LoanTerms, extra: number): ExtraPaymentComparison | null {
  const base = buildSchedule(terms);
  if (!base.feasible) return null;

  const accelerated = buildSchedule({ ...terms, payment: terms.payment + Math.max(0, extra) });
  if (!accelerated.feasible) return null;

  return {
    base,
    accelerated,
    monthsSaved: base.months - accelerated.months,
    interestSaved: round(base.totalInterest - accelerated.totalInterest),
  };
}

/**
 * Roll a monthly schedule up into calendar years for charting - a 30-year
 * mortgage is 360 rows, which is far too many to plot or table directly.
 */
export interface AmortizationYear {
  /** 1-based year number. */
  year: number;
  interest: number;
  principal: number;
  /** Balance remaining at the end of the year. */
  balance: number;
}

export interface LoanProgress {
  /** Whole months elapsed since origination, floored at zero. */
  monthsElapsed: number;
  /** Months left on the original term, or null when no term was recorded. */
  monthsRemaining: number | null;
  /** Fraction of the original term served, 0-1. Null without a term. */
  fractionElapsed: number | null;
  /** True once the original term has run out with a balance still owing. */
  pastTerm: boolean;
}

/**
 * Where a loan sits against its original term, from the origination date the
 * user recorded. This is calendar progress, not principal progress - the two
 * diverge whenever payments have been larger or smaller than scheduled, which
 * is exactly what makes it worth showing next to the projected payoff.
 */
export function loanProgress(
  originationISO: string | null,
  termMonths: number | null,
  todayISO: string,
): LoanProgress | null {
  if (!originationISO) return null;

  const start = parseISODay(originationISO);
  const today = parseISODay(todayISO);
  if (Number.isNaN(start.getTime()) || Number.isNaN(today.getTime())) return null;

  let monthsElapsed =
    (today.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (today.getUTCMonth() - start.getUTCMonth());
  // Only count a month once its day-of-month has come around.
  if (today.getUTCDate() < start.getUTCDate()) monthsElapsed--;
  monthsElapsed = Math.max(0, monthsElapsed);

  if (!termMonths || termMonths <= 0) {
    return { monthsElapsed, monthsRemaining: null, fractionElapsed: null, pastTerm: false };
  }

  return {
    monthsElapsed,
    monthsRemaining: Math.max(0, termMonths - monthsElapsed),
    fractionElapsed: Math.min(1, monthsElapsed / termMonths),
    pastTerm: monthsElapsed >= termMonths,
  };
}

export function byYear(rows: AmortizationRow[]): AmortizationYear[] {
  const years: AmortizationYear[] = [];
  for (let i = 0; i < rows.length; i += 12) {
    const chunk = rows.slice(i, i + 12);
    years.push({
      year: i / 12 + 1,
      interest: round(chunk.reduce((s, r) => s + r.interest, 0)),
      principal: round(chunk.reduce((s, r) => s + r.principal, 0)),
      balance: chunk[chunk.length - 1].balance,
    });
  }
  return years;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmt(n: number): string {
  return `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}
