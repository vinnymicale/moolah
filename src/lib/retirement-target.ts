// The required nest egg: how much the portfolio must hold at retirement.
//
// Everything here is in today's dollars, matching the projection engine, so the
// two can be compared directly.

import type { RetirementAssumptions } from "./retirement-types";

export interface RetirementTarget {
  /** Total annual spending needed in retirement. */
  annualNeed: number;
  /** Portion covered by Social Security. */
  annualFromSocialSecurity: number;
  /** Portion the portfolio must cover. */
  annualFromPortfolio: number;
  /** Portfolio value required to sustain annualFromPortfolio. */
  target: number;
}

/**
 * Required nest egg from salary, replacement ratio, Social Security, and the
 * safe withdrawal rate.
 *
 * A zero withdrawal rate would divide by zero, so it yields a zero target - the
 * UI treats a zero target as "not enough information" rather than "you're done".
 */
export function computeRetirementTarget(a: RetirementAssumptions): RetirementTarget {
  const annualNeed = (a.currentAnnualSalary * a.incomeReplacementRatio) / 100;
  const annualFromSocialSecurity = a.expectedSocialSecurityMonthly * 12;
  const annualFromPortfolio = Math.max(0, annualNeed - annualFromSocialSecurity);
  const rate = a.safeWithdrawalRate / 100;
  const target = rate > 0 ? annualFromPortfolio / rate : 0;

  return {
    annualNeed,
    annualFromSocialSecurity,
    annualFromPortfolio,
    target: Math.round(target * 100) / 100,
  };
}
