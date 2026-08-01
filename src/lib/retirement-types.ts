// Shared types for the retirement calculation layer.
//
// Every calc module takes its assumptions as arguments rather than reading
// RetirementPlan itself. That keeps them pure (testable with no database) and
// makes scenario comparison a matter of passing different numbers.
//
// All percentage fields are human-readable: 7 means 7%, not 0.07.

import { z } from "zod";
import type { ContributionSource } from "@/generated/prisma/enums";

export interface RetirementAssumptions {
  birthYear: number;
  targetRetirementAge: number;
  /** Annual nominal return, as a percent (7 = 7%). */
  expectedReturn: number;
  /** Annual inflation, as a percent (3 = 3%). */
  inflationRate: number;
  /** Share of salary needed in retirement, as a percent (80 = 80%). */
  incomeReplacementRatio: number;
  /** Safe withdrawal rate, as a percent (4 = 4%). */
  safeWithdrawalRate: number;
  /**
   * Expected monthly Social Security benefit in today's dollars, not inflated
   * to the retirement year. SSA statement estimates are already quoted this
   * way, so they can be entered as-is.
   */
  expectedSocialSecurityMonthly: number;
  currentAnnualSalary: number;
}

/** One tier of an employer match: "matchPercent% of the next upToPercentOfSalary% of salary". */
export interface MatchTier {
  matchPercent: number;
  upToPercentOfSalary: number;
}

export const matchTierSchema = z.object({
  matchPercent: z.coerce.number().min(0).max(500),
  upToPercentOfSalary: z.coerce.number().gt(0).max(100),
});

export const matchTiersSchema = z.array(matchTierSchema).max(5);

/** A contribution schedule flattened for the calc layer. */
export interface ScheduledContribution {
  financialAccountId: string;
  amount: number;
  source: ContributionSource;
  frequency: "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  startDate: Date;
  endDate: Date | null;
  dayOfMonth: number | null;
  weekday: number | null;
}

/** A recorded contribution flattened for the calc layer. */
export interface ContributionRecord {
  financialAccountId: string;
  date: Date;
  amount: number;
  source: ContributionSource;
}

/**
 * Convert an annual percentage return to a monthly rate.
 *
 * Uses the twelfth root rather than dividing by 12: at 7% the naive division
 * overstates by roughly 0.2pp a year, which compounds into a materially wrong
 * number across a 30-year horizon.
 */
export function monthlyRateFromAnnual(annualPercent: number): number {
  if (annualPercent === 0) return 0;
  return Math.pow(1 + annualPercent / 100, 1 / 12) - 1;
}
