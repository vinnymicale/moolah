// Which retirement account to fund next, and whether to do it traditional or
// Roth.
//
// The output is an ordered list of steps rather than one verdict, because the
// standard advice is a waterfall: capture the full employer match, then fill an
// IRA, then go back and fill the 401k. Only the deferral steps carry a
// traditional-vs-Roth lean, and that lean is the one genuinely personal call
// here - it turns on the rate you'd deduct at today versus the rate you expect
// to withdraw at later.
//
// This is guidance, not tax advice: it ignores state tax, itemised deductions,
// pensions, and spousal coverage, any of which can flip a marginal call. The UI
// says so.

import type { FilingStatus } from "@/generated/prisma/enums";
import { deferralSavings, marginalRate } from "./tax-brackets";
import { getLimitsForYear } from "./retirement-limits";
import type { MatchResult } from "./contribution-limits";

export type ContributionLean = "TRADITIONAL" | "ROTH" | "SPLIT";

export interface AdviceStep {
  /** Stable key, for React and for tests that assert ordering. */
  key: string;
  title: string;
  detail: string;
  /** Dollars to direct here this year, when a specific figure makes sense. */
  amount: number | null;
  /** Set on steps where the traditional-vs-Roth choice actually applies. */
  lean: ContributionLean | null;
  /** Ranked so the UI can style the top action distinctly. */
  priority: "critical" | "high" | "normal";
}

export interface AccountAdvice {
  steps: AdviceStep[];
  /** Overall traditional-vs-Roth lean for new deferrals. */
  lean: ContributionLean;
  leanReason: string;
  /** Marginal rate the next deferred dollar deducts at, as a percent. */
  currentMarginalRate: number;
  /** Rate we assume applies to withdrawals in retirement, as a percent. */
  projectedRetirementRate: number;
  /** True when the tax tables had to fall back to a nearby year. */
  isFallbackYear: boolean;
  /** True when the IRA choice is forced by the Roth income phase-out. */
  rothIraPhasedOut: boolean;
}

/**
 * Roth IRA contribution income phase-out ranges (modified AGI).
 *
 * Above the top of the range no direct Roth IRA contribution is allowed, which
 * changes the recommendation outright rather than just leaning it.
 *
 * - 2025: Notice 2024-80
 * - 2026: Notice 2025-67
 */
const ROTH_IRA_PHASE_OUT: Record<number, Partial<Record<FilingStatus, { start: number; end: number }>>> = {
  2025: {
    SINGLE: { start: 150_000, end: 165_000 },
    HEAD_OF_HOUSEHOLD: { start: 150_000, end: 165_000 },
    MARRIED_JOINT: { start: 236_000, end: 246_000 },
    MARRIED_SEPARATE: { start: 0, end: 10_000 },
  },
  2026: {
    SINGLE: { start: 153_000, end: 168_000 },
    HEAD_OF_HOUSEHOLD: { start: 153_000, end: 168_000 },
    MARRIED_JOINT: { start: 242_000, end: 252_000 },
    MARRIED_SEPARATE: { start: 0, end: 10_000 },
  },
};

function phaseOutFor(year: number, filingStatus: FilingStatus) {
  const years = Object.keys(ROTH_IRA_PHASE_OUT).map(Number).sort((a, b) => a - b);
  const known = ROTH_IRA_PHASE_OUT[year]
    ? year
    : year < years[0]
      ? years[0]
      : years[years.length - 1];
  return ROTH_IRA_PHASE_OUT[known][filingStatus] ?? ROTH_IRA_PHASE_OUT[known].SINGLE ?? null;
}

/**
 * The tax rate we assume applies to withdrawals in retirement.
 *
 * Retirement income is modelled as the replacement ratio applied to today's
 * salary - that's the same figure the projection targets - and bracketed with
 * today's tables. Using today's brackets for a future year is a simplification,
 * but bracket thresholds are inflation-indexed and the projection works in
 * today's dollars, so the two are consistent with each other.
 */
function retirementRate({
  currentAnnualSalary,
  incomeReplacementRatio,
  filingStatus,
  year,
}: {
  currentAnnualSalary: number;
  incomeReplacementRatio: number;
  filingStatus: FilingStatus;
  year: number;
}): number {
  const income = currentAnnualSalary * (incomeReplacementRatio / 100);
  return marginalRate({ grossIncome: income, filingStatus, year }).rate;
}

export interface AdviceInput {
  age: number;
  currentAnnualSalary: number;
  incomeReplacementRatio: number;
  filingStatus: FilingStatus;
  taxYear: number;
  /** Annual employee deferral currently scheduled, match excluded. */
  annualContribution: number;
  /** Employer match state, when a formula is on file. */
  match: MatchResult | null;
  /** Whether the user has a 401k-style account to defer into. */
  hasWorkplacePlan: boolean;
  /** Whether the user has an IRA on file. */
  hasIra: boolean;
}

export function buildAccountAdvice(input: AdviceInput): AccountAdvice {
  const {
    age,
    currentAnnualSalary,
    incomeReplacementRatio,
    filingStatus,
    taxYear,
    annualContribution,
    match,
    hasWorkplacePlan,
    hasIra,
  } = input;

  const { limits, isFallback: limitsFallback } = getLimitsForYear(taxYear);
  const catchUp = age >= limits.catchUpAge;
  const deferralLimit = catchUp ? limits.electiveDeferralCatchUp : limits.electiveDeferral;
  const iraLimit = catchUp ? limits.iraCatchUp : limits.iraContribution;

  const savings = deferralSavings({
    grossIncome: currentAnnualSalary,
    amount: annualContribution,
    filingStatus,
    year: taxYear,
  });
  const now = savings.topRate;
  const later = retirementRate({ currentAnnualSalary, incomeReplacementRatio, filingStatus, year: taxYear });

  // The core call. A wide gap either way is decisive; a narrow one isn't, and
  // splitting hedges the risk that future rates or your own income surprise you.
  let lean: ContributionLean;
  let leanReason: string;
  if (currentAnnualSalary <= 0) {
    lean = "SPLIT";
    leanReason = "Add your salary in assumptions and this can weigh the tax rates for you.";
  } else if (now - later >= 10) {
    lean = "TRADITIONAL";
    leanReason = `You'd deduct at ${now}% today and likely withdraw around ${later}%. Deferring the tax is worth roughly ${now - later} points.`;
  } else if (later - now >= 10) {
    lean = "ROTH";
    leanReason = `At ${now}% today against about ${later}% in retirement, paying the tax now is the cheaper end.`;
  } else if (now <= 12) {
    lean = "ROTH";
    leanReason = `A ${now}% bracket is about as cheap as tax gets, so a deduction isn't worth much. Locking in tax-free growth is the better trade.`;
  } else if (now >= 32) {
    lean = "TRADITIONAL";
    leanReason = `At ${now}% the deduction is large and hard to beat, and retirement income is rarely taxed that high.`;
  } else {
    lean = "SPLIT";
    leanReason = `${now}% today against about ${later}% later is close enough that neither wins clearly. Splitting hedges which way rates move.`;
  }

  if (age < 30 && lean === "TRADITIONAL" && now < 32) {
    lean = "SPLIT";
    leanReason = `${leanReason} At ${age}, though, decades of tax-free growth and a likely rising income argue for putting some in Roth.`;
  }

  const steps: AdviceStep[] = [];

  if (match && match.forfeitureIsMaterial) {
    steps.push({
      key: "match",
      title: `Raise your deferral to ${match.deferralPercentToMaxMatch.toFixed(1)}% to capture the full match`,
      detail: `You're at ${match.currentDeferralPercent.toFixed(1)}%, leaving about ${Math.round(match.forfeited)} dollars of employer money unclaimed this year. Nothing else here beats an instant 100% return.`,
      amount: match.forfeited,
      lean: null,
      priority: "critical",
    });
  } else if (match) {
    steps.push({
      key: "match-ok",
      title: "You're capturing the full employer match",
      detail: `Your ${match.currentDeferralPercent.toFixed(1)}% deferral fills every tier of the formula. That's the highest-return dollar available, and it's handled.`,
      amount: null,
      lean: null,
      priority: "normal",
    });
  }

  const phaseOut = phaseOutFor(taxYear, filingStatus);
  const rothIraPhasedOut = phaseOut !== null && currentAnnualSalary >= phaseOut.end;
  const rothIraPartial =
    phaseOut !== null && !rothIraPhasedOut && currentAnnualSalary > phaseOut.start;

  if (hasIra || !hasWorkplacePlan) {
    if (rothIraPhasedOut) {
      steps.push({
        key: "ira",
        title: `Fund a traditional IRA, up to ${iraLimit.toLocaleString("en-US")}`,
        detail: `At your income a direct Roth IRA contribution is phased out for ${taxYear}. A traditional IRA still takes the money; whether it's deductible depends on your workplace plan coverage.`,
        amount: iraLimit,
        lean: "TRADITIONAL",
        priority: "high",
      });
    } else {
      steps.push({
        key: "ira",
        title: `Fund an IRA, up to ${iraLimit.toLocaleString("en-US")}`,
        detail: rothIraPartial
          ? `An IRA usually has cheaper funds and more choice than a workplace plan. Your income is inside the ${taxYear} Roth phase-out range, so only part of the limit can go to a Roth.`
          : `An IRA usually has cheaper funds and more choice than a workplace plan, which makes it the natural next dollar after the match.`,
        amount: iraLimit,
        lean,
        priority: "high",
      });
    }
  }

  if (hasWorkplacePlan) {
    const headroom = Math.max(0, deferralLimit - annualContribution);
    if (headroom > 0) {
      steps.push({
        key: "401k-fill",
        title: `Keep filling your 401k, ${Math.round(headroom).toLocaleString("en-US")} of room left`,
        detail: catchUp
          ? `You're ${age}, so the ${taxYear} limit includes the age-${limits.catchUpAge} catch-up: ${deferralLimit.toLocaleString("en-US")} total.`
          : `The ${taxYear} elective deferral limit is ${deferralLimit.toLocaleString("en-US")} across all 401k accounts combined.`,
        amount: headroom,
        lean,
        priority: "normal",
      });
    } else {
      steps.push({
        key: "401k-maxed",
        title: "Your 401k deferral is maxed for the year",
        detail: `You're at the ${taxYear} limit of ${deferralLimit.toLocaleString("en-US")}. Beyond this, a taxable brokerage account is the usual next stop.`,
        amount: null,
        lean: null,
        priority: "normal",
      });
    }
  }

  if (catchUp) {
    steps.push({
      key: "catch-up",
      title: "You're eligible for catch-up contributions",
      detail: `From age ${limits.catchUpAge} the limits rise to ${deferralLimit.toLocaleString("en-US")} for a 401k and ${iraLimit.toLocaleString("en-US")} for an IRA. Worth using if there's room in the budget.`,
      amount: null,
      lean: null,
      priority: "normal",
    });
  }

  return {
    steps,
    lean,
    leanReason,
    currentMarginalRate: now,
    projectedRetirementRate: later,
    isFallbackYear: limitsFallback,
    rothIraPhasedOut,
  };
}
