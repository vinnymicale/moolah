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
  /** Current annual salary in today's dollars, before any future raises. */
  currentAnnualSalary: number;
  /**
   * Real annual salary growth, as a percent (2 = 2% above inflation). Zero means
   * raises that merely keep pace with inflation, leaving salary flat in today's
   * dollars. Only the employer match uses this: the retirement target is
   * deliberately pinned to today's salary, since a target derived from an
   * inflated salary would double-count inflation against a today's-dollars
   * projection.
   */
  salaryGrowthRate: number;
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

/**
 * A contribution schedule flattened for the calc layer.
 *
 * `amount` is always per-occurrence dollars: percent-of-salary schedules are
 * resolved against salary before they get here, so the calc layer never has to
 * know which basis a schedule was entered in.
 */
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

/** How a schedule states its size, mirroring the ContributionBasis enum. */
export type ContributionBasis = "AMOUNT" | "PERCENT_OF_SALARY";

/** Occurrences per year for each frequency, for converting a percent of salary into per-occurrence dollars. */
export const OCCURRENCES_PER_YEAR: Record<ScheduledContribution["frequency"], number> = {
  DAILY: 365.25,
  WEEKLY: 52,
  BIWEEKLY: 26,
  MONTHLY: 12,
  YEARLY: 1,
};

/**
 * Per-occurrence dollars for a percent-of-salary schedule.
 *
 * Deliberately unrounded: rounding 6% of $115,000 biweekly to $265.38 loses
 * $0.0004 a paycheck, which reads back as 5.9998% and shows up as a bogus
 * "you're leaving match on the table" warning. The exact figure annualises
 * back to the salary percentage precisely.
 */
export function percentScheduleAmount({
  percentOfSalary,
  annualSalary,
  frequency,
  interval,
}: {
  percentOfSalary: number;
  annualSalary: number;
  frequency: ScheduledContribution["frequency"];
  interval: number;
}): number {
  if (annualSalary <= 0 || percentOfSalary <= 0) return 0;
  const perYear = OCCURRENCES_PER_YEAR[frequency] / (interval || 1);
  if (perYear <= 0) return 0;
  return (annualSalary * (percentOfSalary / 100)) / perYear;
}

/** A recorded contribution flattened for the calc layer. */
export interface ContributionRecord {
  financialAccountId: string;
  date: Date;
  amount: number;
  source: ContributionSource;
  /**
   * The tax year this contribution counts toward, when it differs from the
   * deposit date's year. IRA contributions can be designated for the prior year
   * up to the filing deadline, so a March deposit may belong to the year before.
   * Null means "use the deposit year".
   */
  taxYear?: number | null;
}

/**
 * A hand-entered year-to-date total, flattened for the calc layer. One per
 * account/source pair within a tax year.
 */
export interface YtdContributionRecord {
  financialAccountId: string;
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
