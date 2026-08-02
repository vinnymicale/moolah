// Post-retirement depletion modeling: how long the money lasts.
//
// Without Monte Carlo, honesty comes from spread rather than a single number.
// We run three fixed return scenarios and report the range, plus a
// sequence-of-returns stress case: the same average return, but poor returns in
// the first five years. That ordering is what actually ruins retirements, and a
// single average return hides it completely.
//
// Everything is in real (inflation-adjusted) terms, so the withdrawal stays
// constant in today's dollars.

import { monthlyRateFromAnnual } from "./retirement-types";

export interface DrawdownScenario {
  label: string;
  realAnnualReturn: number;
  /** Whole years the portfolio sustained withdrawals, capped at maxYears. */
  yearsLasted: number;
  depleted: boolean;
  /** Balance at the end of the horizon; zero when depleted. */
  endingBalance: number;
}

export interface DrawdownReport {
  scenarios: DrawdownScenario[];
  stressCase: DrawdownScenario;
  annualWithdrawal: number;
}

export const DEFAULT_MAX_YEARS = 40;
const SCENARIO_SPREAD = 2;
const STRESS_YEARS = 5;
const STRESS_PENALTY = 10;

/**
 * Walk the portfolio down month by month.
 *
 * `penaltyYears`/`penaltyPercent` model a sequence-of-returns shock: returns are
 * reduced by penaltyPercent for the first penaltyYears, then raised for an equal
 * span so the long-run average is unchanged and only the ordering differs.
 */
function simulate(
  label: string,
  nestEgg: number,
  annualWithdrawal: number,
  realAnnualReturn: number,
  maxYears: number,
  penaltyYears = 0,
  penaltyPercent = 0,
): DrawdownScenario {
  const monthlyWithdrawal = annualWithdrawal / 12;
  let balance = nestEgg;
  let months = 0;
  const maxMonths = maxYears * 12;

  while (months < maxMonths) {
    const year = Math.floor(months / 12);
    let annual = realAnnualReturn;
    if (penaltyYears > 0) {
      if (year < penaltyYears) annual -= penaltyPercent;
      else if (year < penaltyYears * 2) annual += penaltyPercent;
    }

    balance = balance * (1 + monthlyRateFromAnnual(annual)) - monthlyWithdrawal;
    if (balance <= 0) {
      return {
        label,
        realAnnualReturn,
        yearsLasted: Math.floor(months / 12),
        depleted: true,
        endingBalance: 0,
      };
    }
    months++;
  }

  return {
    label,
    realAnnualReturn,
    yearsLasted: maxYears,
    depleted: false,
    endingBalance: Math.round(balance * 100) / 100,
  };
}

export function modelDrawdown({
  nestEgg,
  annualWithdrawal,
  realAnnualReturn,
  maxYears = DEFAULT_MAX_YEARS,
}: {
  nestEgg: number;
  annualWithdrawal: number;
  /** Real (inflation-adjusted) annual return as a percent. */
  realAnnualReturn: number;
  maxYears?: number;
}): DrawdownReport {
  const scenarios = [
    simulate("Poor returns", nestEgg, annualWithdrawal, realAnnualReturn - SCENARIO_SPREAD, maxYears),
    simulate("Expected", nestEgg, annualWithdrawal, realAnnualReturn, maxYears),
    simulate("Strong returns", nestEgg, annualWithdrawal, realAnnualReturn + SCENARIO_SPREAD, maxYears),
  ];

  const stressCase = simulate(
    "Bad first five years",
    nestEgg,
    annualWithdrawal,
    realAnnualReturn,
    maxYears,
    STRESS_YEARS,
    STRESS_PENALTY,
  );

  return { scenarios, stressCase, annualWithdrawal };
}
