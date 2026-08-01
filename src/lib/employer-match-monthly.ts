// The employer match a given contribution pace earns, expressed monthly.
//
// The match tiers are annual and salary-relative, so a monthly figure only
// makes sense by annualising the deferral, running the tier formula, and
// dividing back down. Doing it the other way around (matching each month in
// isolation) would misprice any tier the deferral only partly reaches.
//
// This assumes the deferral pace holds for the whole year, which is the same
// assumption the projection makes about schedules generally.

import { computeMatch } from "./contribution-limits";
import type { MatchTier } from "./retirement-types";

export function monthlyEmployerMatch({
  monthlyDeferral,
  annualSalary,
  tiers,
  annualCap,
}: {
  monthlyDeferral: number;
  annualSalary: number;
  tiers: MatchTier[];
  annualCap: number | null;
}): number {
  if (monthlyDeferral <= 0 || tiers.length === 0) return 0;

  const { projectedMatch } = computeMatch({
    annualSalary,
    annualDeferral: monthlyDeferral * 12,
    tiers,
    annualCap,
  });

  return Math.round((projectedMatch / 12) * 100) / 100;
}

/**
 * Salary after `months` of real growth, in today's dollars.
 *
 * The rate is real, not nominal: it's how fast pay outruns inflation, so 0 means
 * raises that exactly track inflation and buy no extra purchasing power. That
 * keeps the result denominated in today's dollars like everything else in the
 * retirement module, and it's why the projection can apply it directly without
 * deflating afterwards.
 *
 * Compounds fractionally rather than stepping once a year, so a mid-year
 * horizon doesn't sit on a stale figure for eleven months.
 */
export function salaryAfterRealGrowth(
  currentAnnualSalary: number,
  realGrowthPercent: number,
  months: number,
): number {
  if (realGrowthPercent === 0 || months <= 0) return currentAnnualSalary;
  return currentAnnualSalary * Math.pow(1 + realGrowthPercent / 100, months / 12);
}
