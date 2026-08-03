// Year-to-date contribution usage against IRS limits, plus employer match
// capture.
//
// Limits are per person per year across all accounts, so everything here
// aggregates by source rather than by account. The one exception is the IRA
// limit, which applies only to contributions landing in IRA-type accounts - the
// caller passes those account ids.

import { sumMoney } from "./money";
import { getLimitsForYear } from "./retirement-limits";
import type { ContributionRecord, MatchTier, YtdContributionRecord } from "./retirement-types";

export interface LimitUsage {
  label: string;
  used: number;
  limit: number;
  remaining: number;
  percentUsed: number;
}

export interface MatchResult {
  /** Match ceiling for the year: what fully filling every tier would earn, capped by annualCap if set. */
  maxAnnualMatch: number;
  /** Match earned at the current deferral pace. */
  projectedMatch: number;
  /** maxAnnualMatch - projectedMatch: free money left on the table. */
  forfeited: number;
  capturedPercent: number;
  /** Deferral, as a percent of salary, that fully fills every tier of the formula. */
  deferralPercentToMaxMatch: number;
  /** Current deferral as a percent of salary, for comparison against deferralPercentToMaxMatch. */
  currentDeferralPercent: number;
  tiers: MatchTier[];
}

export interface ContributionLimitReport {
  year: number;
  isFallbackYear: boolean;
  catchUpEligible: boolean;
  electiveDeferral: LimitUsage;
  totalAdditions: LimitUsage;
  ira: LimitUsage;
  match: MatchResult | null;
  /** True when hand-entered YTD totals drove these figures instead of logged contributions. */
  usesYtdOverride: boolean;
}

/**
 * Which year a contribution counts toward: its explicit designation when set,
 * otherwise the year it was deposited.
 */
export function taxYearOf(c: ContributionRecord): number {
  return c.taxYear ?? c.date.getUTCFullYear();
}

function usage(label: string, used: number, limit: number): LimitUsage {
  const remaining = Math.max(0, limit - used);
  return {
    label,
    used: Math.round(used * 100) / 100,
    limit,
    remaining: Math.round(remaining * 100) / 100,
    percentUsed: limit > 0 ? Math.min(100, (used / limit) * 100) : 0,
  };
}

/**
 * Employer match earned at a given annual deferral, under a tiered formula.
 *
 * Tiers are consumed in order: "100% of the first 3%, then 50% of the next 2%"
 * is two tiers, each expressed as a share of salary. A deferral that stops
 * partway through a tier earns a proportional share of that tier.
 */
export function computeMatch({
  annualSalary,
  annualDeferral,
  tiers,
  annualCap,
}: {
  annualSalary: number;
  annualDeferral: number;
  tiers: MatchTier[];
  annualCap: number | null;
}): MatchResult {
  if (annualSalary <= 0 || tiers.length === 0) {
    return {
      maxAnnualMatch: 0,
      projectedMatch: 0,
      forfeited: 0,
      capturedPercent: 0,
      deferralPercentToMaxMatch: 0,
      currentDeferralPercent: 0,
      tiers,
    };
  }

  let maxMatch = 0;
  let earnedMatch = 0;
  let salaryConsumed = 0;
  let salaryPercentConsumed = 0;

  for (const tier of tiers) {
    const tierDollars = (annualSalary * tier.upToPercentOfSalary) / 100;
    maxMatch += (tierDollars * tier.matchPercent) / 100;

    // How much of this tier the actual deferral reaches into.
    const deferralIntoTier = Math.max(0, Math.min(tierDollars, annualDeferral - salaryConsumed));
    earnedMatch += (deferralIntoTier * tier.matchPercent) / 100;
    salaryConsumed += tierDollars;
    salaryPercentConsumed += tier.upToPercentOfSalary;
  }

  if (annualCap !== null) {
    maxMatch = Math.min(maxMatch, annualCap);
    earnedMatch = Math.min(earnedMatch, annualCap);
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    maxAnnualMatch: round(maxMatch),
    projectedMatch: round(earnedMatch),
    forfeited: round(Math.max(0, maxMatch - earnedMatch)),
    capturedPercent: maxMatch > 0 ? (earnedMatch / maxMatch) * 100 : 0,
    deferralPercentToMaxMatch: salaryPercentConsumed,
    currentDeferralPercent: (annualDeferral / annualSalary) * 100,
    tiers,
  };
}

export function computeContributionLimits({
  contributions,
  ytdContributions = [],
  year,
  age,
  iraAccountIds,
  annualSalary,
  matchTiers,
  matchAnnualCap,
  annualDeferralPace,
}: {
  contributions: ContributionRecord[];
  /**
   * Hand-entered YTD totals for `year`. When non-empty these replace the logged
   * contributions entirely rather than adding to them, so a deposit that was
   * both logged and included in a statement total is not counted twice.
   */
  ytdContributions?: YtdContributionRecord[];
  year: number;
  age: number;
  iraAccountIds: string[];
  annualSalary: number;
  matchTiers: MatchTier[] | null;
  matchAnnualCap: number | null;
  /** Annualized deferral at the current payroll pace, for the match projection - not YTD dollars. */
  annualDeferralPace: number;
}): ContributionLimitReport {
  const { limits, isFallback } = getLimitsForYear(year);
  const catchUpEligible = age >= limits.catchUpAge;

  const usesYtdOverride = ytdContributions.length > 0;
  const thisYear: YtdContributionRecord[] = usesYtdOverride
    ? ytdContributions
    : contributions.filter((c) => taxYearOf(c) === year);

  // Elective deferrals: pre-tax and Roth share one limit. Employer match,
  // after-tax, and rollovers are excluded.
  const deferralAmounts = thisYear
    .filter((c) => c.source === "EMPLOYEE_PRETAX" || c.source === "EMPLOYEE_ROTH")
    .map((c) => c.amount);
  const deferralUsed = sumMoney(deferralAmounts);

  // Total additions: everything except rollovers, which are transfers of
  // already-contributed money rather than new contributions.
  const additionsUsed = sumMoney(
    thisYear.filter((c) => c.source !== "ROLLOVER").map((c) => c.amount),
  );

  const iraSet = new Set(iraAccountIds);
  const iraUsed = sumMoney(
    thisYear
      .filter((c) => iraSet.has(c.financialAccountId) && c.source !== "ROLLOVER")
      .map((c) => c.amount),
  );

  return {
    year,
    isFallbackYear: isFallback,
    catchUpEligible,
    usesYtdOverride,
    electiveDeferral: usage(
      "Employee contributions",
      deferralUsed,
      catchUpEligible ? limits.electiveDeferralCatchUp : limits.electiveDeferral,
    ),
    totalAdditions: usage("Total additions", additionsUsed, limits.totalAdditions),
    ira: usage(
      "IRA contributions",
      iraUsed,
      catchUpEligible ? limits.iraCatchUp : limits.iraContribution,
    ),
    match: matchTiers
      ? computeMatch({
          annualSalary,
          annualDeferral: annualDeferralPace,
          tiers: matchTiers,
          annualCap: matchAnnualCap,
        })
      : null,
  };
}
