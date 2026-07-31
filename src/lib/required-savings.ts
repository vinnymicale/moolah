// The inverse of the projection: how much must be contributed monthly to hit
// the target by the retirement date.
//
// Solves the future-value-of-annuity formula for the payment. Closed form, no
// iteration. This mirrors the projection engine's grow-then-add convention (a
// contribution earns no return in the month it arrives), so unrolling that
// month-by-month recurrence gives:
//
//   FV = PV(1+r)^n + PMT * ((1+r)^n - 1) / r
//   PMT = (FV - PV(1+r)^n) * r / ((1+r)^n - 1)
//
// At r = 0 the annuity factor collapses to n, so the gap is simply spread
// evenly across the remaining months.

import { monthlyRateFromAnnual } from "./retirement-types";

export interface RequiredSavings {
  /** Monthly contribution needed to reach the target. */
  requiredMonthly: number;
  /** What the user currently contributes monthly. */
  currentMonthly: number;
  /** How much more per month is needed; zero when already on track. */
  shortfallMonthly: number;
  /** requiredMonthly as a percentage of annual salary, or null when salary is unset. */
  percentOfSalary: number | null;
  onTrack: boolean;
}

export function computeRequiredSavings({
  target,
  startingBalance,
  monthsToRetirement,
  realAnnualReturn,
  currentMonthly,
  annualSalary,
}: {
  target: number;
  startingBalance: number;
  monthsToRetirement: number;
  /** Real (inflation-adjusted) annual return as a percent. */
  realAnnualReturn: number;
  currentMonthly: number;
  annualSalary: number;
}): RequiredSavings {
  const rate = monthlyRateFromAnnual(realAnnualReturn);
  const n = monthsToRetirement;

  let requiredMonthly = 0;
  if (n > 0) {
    const growthFactor = Math.pow(1 + rate, n);
    const futureValueOfCurrentBalance = startingBalance * growthFactor;
    const gap = target - futureValueOfCurrentBalance;

    if (gap > 0) {
      // Annuity factor; degenerates to n when the rate is zero.
      const annuityFactor = rate === 0 ? n : (growthFactor - 1) / rate;
      requiredMonthly = annuityFactor > 0 ? gap / annuityFactor : 0;
    }
  }

  requiredMonthly = Math.round(requiredMonthly * 100) / 100;
  const shortfallMonthly = Math.max(0, Math.round((requiredMonthly - currentMonthly) * 100) / 100);

  return {
    requiredMonthly,
    currentMonthly,
    shortfallMonthly,
    percentOfSalary:
      annualSalary > 0 ? (requiredMonthly * 12 * 100) / annualSalary : null,
    onTrack: shortfallMonthly === 0,
  };
}
