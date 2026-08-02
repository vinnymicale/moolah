// Assembles everything the /retirement page renders.
//
// The calc modules are pure and take assumptions as arguments; this is the only
// layer that touches the database, so it reads rows, converts Decimals to
// numbers, and hands plain data to the calculators.

import { prisma } from "@/lib/prisma";
import { toNumber, sumMoney } from "@/lib/money";
import { addUTCMonths, isoDay, parseISODay } from "@/lib/dates";
import { getNetWorthHistory } from "@/lib/snapshots";
import {
  matchTiersSchema,
  type MatchTier,
  type RetirementAssumptions,
  type ContributionRecord,
  type ScheduledContribution,
} from "@/lib/retirement-types";
import {
  projectRetirement,
  monthsUntilRetirement,
  type ProjectionResult,
} from "@/lib/retirement-projection";
import { computeRetirementTarget, type RetirementTarget } from "@/lib/retirement-target";
import { computeRequiredSavings, type RequiredSavings } from "@/lib/required-savings";
import { monthlyEmployerMatch, salaryAfterRealGrowth } from "@/lib/employer-match-monthly";
import {
  computeContributionLimits,
  taxYearOf,
  type ContributionLimitReport,
} from "@/lib/contribution-limits";
import { modelDrawdown, type DrawdownReport } from "@/lib/drawdown";
import { attributeGrowth, type GrowthAttribution } from "@/lib/retirement-growth";
import type { ContributionSource } from "@/generated/prisma/enums";

/** Account types that fund retirement. */
const RETIREMENT_TYPES = ["RETIREMENT", "INVESTMENT"] as const;

/** Growth attribution looks back this far. */
const GROWTH_LOOKBACK_MONTHS = 12;

export interface RetirementAccountDTO {
  id: string;
  name: string;
  type: string;
  balance: number;
  color: string;
  /** IRA-type, so contributions can be designated for the prior tax year. */
  isIra: boolean;
}

export interface ContributionDTO {
  id: string;
  accountName: string;
  date: string;
  amount: number;
  source: ContributionSource;
  /** Set only when the contribution counts toward a year other than its deposit year. */
  taxYear: number | null;
  note: string | null;
}

export interface RetirementPageData {
  hasPlan: boolean;
  hasAccounts: boolean;
  assumptions: RetirementAssumptions | null;
  accounts: RetirementAccountDTO[];
  totalBalance: number;
  projection: ProjectionResult | null;
  coastProjection: ProjectionResult | null;
  target: RetirementTarget | null;
  requiredSavings: RequiredSavings | null;
  limits: ContributionLimitReport | null;
  growth: GrowthAttribution | null;
  drawdown: DrawdownReport | null;
  recentContributions: ContributionDTO[];
  /** Hand-entered YTD totals for the current tax year. Empty when none are set. */
  ytdContributions: YtdContributionDTO[];
  /** The tax year the limit bars and YTD totals cover. */
  currentTaxYear: number;
  /** Tax years that have contributions or YTD totals, newest first, always including the current one. */
  availableTaxYears: number[];
  /** Monthly total of the user's own scheduled contributions, match excluded. */
  currentMonthlyContribution: number;
  /** Monthly employer match earned at that contribution pace. */
  currentMonthlyEmployerMatch: number;
  /** The saved match formula, for display and editing. Null when none is set. */
  employerMatch: EmployerMatchDTO | null;
  /** Real return derived from expectedReturn and inflationRate, as a percent. */
  realAnnualReturn: number;
}

export interface EmployerMatchDTO {
  financialAccountId: string;
  tiers: MatchTier[];
  annualCap: number | null;
}

export interface YtdContributionDTO {
  financialAccountId: string;
  source: ContributionSource;
  amount: number;
}

/** Average occurrences per month for each frequency, for normalising a schedule to monthly. */
const OCCURRENCES_PER_MONTH: Record<string, number> = {
  DAILY: 30.44,
  WEEKLY: 52 / 12,
  BIWEEKLY: 26 / 12,
  MONTHLY: 1,
  YEARLY: 1 / 12,
};

function scheduleToMonthly(s: ScheduledContribution): number {
  const per = OCCURRENCES_PER_MONTH[s.frequency] ?? 1;
  return (s.amount * per) / (s.interval || 1);
}

/** IRA-type accounts, matched by name since we don't store a Plaid subtype locally. */
function looksLikeIra(name: string): boolean {
  return /\bira\b|roth/i.test(name);
}

export async function getRetirementPageData(
  userId: string,
  todayISO: string,
  selectedTaxYear?: number,
): Promise<RetirementPageData> {
  const thisYear = parseISODay(todayISO).getUTCFullYear();
  // A future year has no limits to report against, so anything past this one
  // falls back rather than rendering an empty set of bars.
  const currentTaxYear =
    selectedTaxYear != null && selectedTaxYear <= thisYear ? selectedTaxYear : thisYear;

  const [planRow, accountRows, contributionRows, scheduleRows, ytdRows] = await Promise.all([
    prisma.retirementPlan.findUnique({ where: { userId } }),
    prisma.financialAccount.findMany({
      where: { userId, archived: false, type: { in: [...RETIREMENT_TYPES] } },
      select: { id: true, name: true, type: true, currentBalance: true, color: true },
      orderBy: { name: "asc" },
    }),
    prisma.contribution.findMany({
      where: { userId },
      orderBy: { date: "desc" },
      include: { financialAccount: { select: { name: true } } },
    }),
    prisma.contributionSchedule.findMany({ where: { userId, archived: false } }),
    prisma.ytdContribution.findMany({ where: { userId } }),
  ]);

  const ytdRowsForYear = ytdRows.filter((y) => y.year === currentTaxYear);

  const ytdContributions: YtdContributionDTO[] = ytdRowsForYear.map((y) => ({
    financialAccountId: y.financialAccountId,
    source: y.source,
    amount: toNumber(y.amount),
  }));

  const accounts: RetirementAccountDTO[] = accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    balance: toNumber(a.currentBalance),
    color: a.color,
    isIra: looksLikeIra(a.name),
  }));
  const totalBalance = sumMoney(accounts.map((a) => a.balance));

  const contributions: ContributionRecord[] = contributionRows.map((c) => ({
    financialAccountId: c.financialAccountId,
    date: c.date,
    amount: toNumber(c.amount),
    source: c.source,
    taxYear: c.taxYear,
  }));

  // The years the picker can offer. The current year is always there even with
  // nothing logged yet, so a fresh account still has a year to sit on.
  const availableTaxYears = [
    ...new Set([
      thisYear,
      ...contributions.map(taxYearOf),
      ...ytdRows.map((y) => y.year),
      currentTaxYear,
    ]),
  ]
    .filter((y) => y <= thisYear)
    .sort((a, b) => b - a);

  const schedules: ScheduledContribution[] = scheduleRows.map((s) => ({
    financialAccountId: s.financialAccountId,
    amount: toNumber(s.amount),
    source: s.source,
    frequency: s.frequency,
    interval: s.interval,
    startDate: s.startDate,
    endDate: s.endDate,
    dayOfMonth: s.dayOfMonth,
    weekday: s.weekday,
  }));

  const currentMonthlyContribution =
    Math.round(schedules.reduce((sum, s) => sum + scheduleToMonthly(s), 0) * 100) / 100;

  // Only elective deferrals earn a match; after-tax and rollover money does not.
  const monthlyDeferral =
    Math.round(
      schedules
        .filter((s) => s.source === "EMPLOYEE_PRETAX" || s.source === "EMPLOYEE_ROTH")
        .reduce((sum, s) => sum + scheduleToMonthly(s), 0) * 100,
    ) / 100;

  const matchRow = await prisma.employerMatch.findFirst({
    where: { userId, financialAccountId: { in: accounts.map((a) => a.id) } },
  });
  const parsedTiers = matchRow ? matchTiersSchema.safeParse(matchRow.tiers) : null;
  const matchTiers: MatchTier[] | null =
    parsedTiers && parsedTiers.success ? parsedTiers.data : null;
  const matchAnnualCap = matchRow?.annualCap ? toNumber(matchRow.annualCap) : null;
  const employerMatch: EmployerMatchDTO | null =
    matchRow && matchTiers
      ? {
          financialAccountId: matchRow.financialAccountId,
          tiers: matchTiers,
          annualCap: matchAnnualCap,
        }
      : null;

  // Scoped to the selected year so the log lines up with the limit bars above
  // it; a deposit backdated to a prior year shows under that year, not this one.
  const recentContributions: ContributionDTO[] = contributionRows
    .filter((c) => (c.taxYear ?? c.date.getUTCFullYear()) === currentTaxYear)
    .slice(0, 10)
    .map((c) => ({
      id: c.id,
      accountName: c.financialAccount.name,
      date: isoDay(c.date),
      amount: toNumber(c.amount),
      source: c.source,
      taxYear: c.taxYear,
      note: c.note,
    }));

  const hasAccounts = accounts.length > 0;
  const hasPlan = planRow !== null && planRow.completedAt !== null;

  if (!hasPlan || planRow === null) {
    return {
      hasPlan: false,
      hasAccounts,
      assumptions: null,
      accounts,
      totalBalance,
      projection: null,
      coastProjection: null,
      target: null,
      requiredSavings: null,
      limits: null,
      growth: null,
      drawdown: null,
      recentContributions,
      ytdContributions,
      currentTaxYear,
      availableTaxYears,
      currentMonthlyContribution,
      currentMonthlyEmployerMatch: 0,
      employerMatch,
      realAnnualReturn: 0,
    };
  }

  const assumptions: RetirementAssumptions = {
    birthYear: planRow.birthYear,
    targetRetirementAge: planRow.targetRetirementAge,
    expectedReturn: toNumber(planRow.expectedReturn),
    inflationRate: toNumber(planRow.inflationRate),
    incomeReplacementRatio: toNumber(planRow.incomeReplacementRatio),
    safeWithdrawalRate: toNumber(planRow.safeWithdrawalRate),
    expectedSocialSecurityMonthly: toNumber(planRow.expectedSocialSecurityMonthly),
    currentAnnualSalary: toNumber(planRow.currentAnnualSalary),
    salaryGrowthRate: toNumber(planRow.salaryGrowthRate),
  };

  const realAnnualReturn =
    ((1 + assumptions.expectedReturn / 100) / (1 + assumptions.inflationRate / 100) - 1) * 100;

  const currentMonthlyEmployerMatch = matchTiers
    ? monthlyEmployerMatch({
        monthlyDeferral,
        annualSalary: assumptions.currentAnnualSalary,
        tiers: matchTiers,
        annualCap: matchAnnualCap,
      })
    : 0;

  // The match is real money landing in the account, so the projection has to
  // compound it alongside the user's own contributions. Modelling it as extra
  // monthly schedules keeps the engine unchanged and lets the match ride the
  // same grow-then-add convention.
  //
  // Tiers are a share of salary, so a rising real salary raises the match too.
  // One schedule per year steps the matched amount up over the horizon; at a
  // zero growth rate every rung is identical and this collapses to a single
  // flat match.
  const projectedSchedules: ScheduledContribution[] = [...schedules];
  if (matchTiers && matchRow && monthlyDeferral > 0) {
    const startOfHorizon = parseISODay(todayISO);
    const monthsToRetirement = monthsUntilRetirement(assumptions, startOfHorizon);
    const yearsToRetirement = Math.ceil(monthsToRetirement / 12);
    for (let y = 0; y < yearsToRetirement; y++) {
      // The deferral is assumed to hold as a share of pay, so it rises with
      // salary; otherwise a raise would shrink the percentage deferred and eat
      // into the match rather than growing it.
      const growth = salaryAfterRealGrowth(1, assumptions.salaryGrowthRate, y * 12);
      const amount = monthlyEmployerMatch({
        monthlyDeferral: monthlyDeferral * growth,
        annualSalary: assumptions.currentAnnualSalary * growth,
        tiers: matchTiers,
        annualCap: matchAnnualCap,
      });
      if (amount <= 0) continue;
      projectedSchedules.push({
        financialAccountId: matchRow.financialAccountId,
        amount,
        source: "EMPLOYER_MATCH",
        frequency: "MONTHLY",
        interval: 1,
        startDate: addUTCMonths(startOfHorizon, y * 12),
        // The last rung runs to the horizon rather than to its own twelfth
        // month, so a horizon that ends mid-year still gets matched all the way.
        endDate:
          y === yearsToRetirement - 1
            ? addUTCMonths(startOfHorizon, monthsToRetirement)
            : addUTCMonths(startOfHorizon, (y + 1) * 12 - 1),
        dayOfMonth: 1,
        weekday: null,
      });
    }
  }

  const projection = projectRetirement({
    assumptions,
    startingBalance: totalBalance,
    schedules: projectedSchedules,
    todayISO,
  });
  const coastProjection = projectRetirement({
    assumptions,
    startingBalance: totalBalance,
    schedules: projectedSchedules,
    todayISO,
    includeContributions: false,
  });

  const target = computeRetirementTarget(assumptions);

  const requiredSavings = computeRequiredSavings({
    target: target.target,
    startingBalance: totalBalance,
    monthsToRetirement: projection.monthsToRetirement,
    realAnnualReturn,
    currentMonthly: currentMonthlyContribution + currentMonthlyEmployerMatch,
    annualSalary: assumptions.currentAnnualSalary,
  });

  const today = parseISODay(todayISO);
  const age = currentTaxYear - assumptions.birthYear;

  const limits = computeContributionLimits({
    contributions,
    ytdContributions,
    year: currentTaxYear,
    age,
    iraAccountIds: accounts.filter((a) => a.isIra).map((a) => a.id),
    annualSalary: assumptions.currentAnnualSalary,
    matchTiers,
    matchAnnualCap,
  });

  // Growth attribution over the last year of snapshot history, restricted to
  // the retirement/investment accounts. endBalance is totalBalance, which sums
  // only those accounts, so startBalance has to come from the same set - a
  // whole-portfolio figure here would subtract balances that were never in the
  // end total and report the difference as market return.
  //
  // lookbackStart is inclusive and today is treated as the exclusive-on-both-
  // sides upper bound inside attributeGrowth (it expands occurrences to
  // addUTCDays(endDate, -1) and filters contributions with date < endDate), so
  // passing `today` here as endDate is correct - it does not need to be pushed
  // forward a day.
  const lookbackStart = addUTCMonths(today, -GROWTH_LOOKBACK_MONTHS);
  const retirementAccountIds = accounts.map((a) => a.id);
  // Each account's last snapshot at or before the lookback start. Accounts with
  // no snapshot that far back simply do not contribute to the start balance.
  const priorSnapshots = retirementAccountIds.length
    ? await prisma.accountSnapshot.findMany({
        where: { accountId: { in: retirementAccountIds }, date: { lte: lookbackStart } },
        orderBy: { date: "desc" },
        select: { accountId: true, balance: true },
      })
    : [];
  const startByAccount = new Map<string, number>();
  for (const s of priorSnapshots) {
    if (!startByAccount.has(s.accountId)) startByAccount.set(s.accountId, toNumber(s.balance));
  }
  const growth =
    startByAccount.size > 0
      ? attributeGrowth({
          startBalance: sumMoney([...startByAccount.values()]),
          endBalance: totalBalance,
          contributions,
          schedules,
          startDate: lookbackStart,
          endDate: today,
        })
      : null;

  const drawdown = modelDrawdown({
    nestEgg: projection.finalBalance,
    annualWithdrawal: target.annualFromPortfolio,
    realAnnualReturn,
  });

  return {
    hasPlan: true,
    hasAccounts,
    assumptions,
    accounts,
    totalBalance,
    projection,
    coastProjection,
    target,
    requiredSavings,
    limits,
    growth,
    drawdown,
    recentContributions,
    ytdContributions,
    currentTaxYear,
    availableTaxYears,
    currentMonthlyContribution,
    currentMonthlyEmployerMatch,
    employerMatch,
    realAnnualReturn,
  };
}

/**
 * Contributed-capital vs. market-gains series for the net-worth chart's optional
 * growth band. Walks snapshot history forward, accumulating contributions so
 * each day splits investment value into money added and money earned.
 */
export async function getInvestmentGrowthSeries(
  userId: string,
  days: number,
  todayISO: string,
): Promise<{ date: string; contributed: number; gains: number }[]> {
  const [history, contributionRows] = await Promise.all([
    getNetWorthHistory(userId, days, todayISO),
    prisma.contribution.findMany({ where: { userId }, orderBy: { date: "asc" } }),
  ]);
  if (history.length === 0) return [];

  const start = parseISODay(history[0].date);
  const baseline = history[0].assets;

  // Cumulative contributions by ISO day, from the window start onward.
  const byDay = new Map<string, number>();
  for (const c of contributionRows) {
    if (c.date.getTime() < start.getTime()) continue;
    const key = isoDay(c.date);
    byDay.set(key, (byDay.get(key) ?? 0) + toNumber(c.amount));
  }

  let cumulative = 0;
  return history.map((point) => {
    cumulative += byDay.get(point.date) ?? 0;
    const contributed = baseline + cumulative;
    return {
      date: point.date,
      contributed: Math.round(contributed * 100) / 100,
      gains: Math.round((point.assets - contributed) * 100) / 100,
    };
  });
}
