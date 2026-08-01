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
import { projectRetirement, type ProjectionResult } from "@/lib/retirement-projection";
import { computeRetirementTarget, type RetirementTarget } from "@/lib/retirement-target";
import { computeRequiredSavings, type RequiredSavings } from "@/lib/required-savings";
import {
  computeContributionLimits,
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
}

export interface ContributionDTO {
  id: string;
  accountName: string;
  date: string;
  amount: number;
  source: ContributionSource;
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
  currentMonthlyContribution: number;
  /** Real return derived from expectedReturn and inflationRate, as a percent. */
  realAnnualReturn: number;
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
): Promise<RetirementPageData> {
  const [planRow, accountRows, contributionRows, scheduleRows] = await Promise.all([
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
  ]);

  const accounts: RetirementAccountDTO[] = accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    balance: toNumber(a.currentBalance),
    color: a.color,
  }));
  const totalBalance = sumMoney(accounts.map((a) => a.balance));

  const contributions: ContributionRecord[] = contributionRows.map((c) => ({
    financialAccountId: c.financialAccountId,
    date: c.date,
    amount: toNumber(c.amount),
    source: c.source,
  }));

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

  const recentContributions: ContributionDTO[] = contributionRows.slice(0, 10).map((c) => ({
    id: c.id,
    accountName: c.financialAccount.name,
    date: isoDay(c.date),
    amount: toNumber(c.amount),
    source: c.source,
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
      currentMonthlyContribution,
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
  };

  const realAnnualReturn =
    ((1 + assumptions.expectedReturn / 100) / (1 + assumptions.inflationRate / 100) - 1) * 100;

  const projection = projectRetirement({
    assumptions,
    startingBalance: totalBalance,
    schedules,
    todayISO,
  });
  const coastProjection = projectRetirement({
    assumptions,
    startingBalance: totalBalance,
    schedules,
    todayISO,
    includeContributions: false,
  });

  const target = computeRetirementTarget(assumptions);

  const requiredSavings = computeRequiredSavings({
    target: target.target,
    startingBalance: totalBalance,
    monthsToRetirement: projection.monthsToRetirement,
    realAnnualReturn,
    currentMonthly: currentMonthlyContribution,
    annualSalary: assumptions.currentAnnualSalary,
  });

  const today = parseISODay(todayISO);
  const year = today.getUTCFullYear();
  const age = year - assumptions.birthYear;

  const matchRow = await prisma.employerMatch.findFirst({
    where: { userId, financialAccountId: { in: accounts.map((a) => a.id) } },
  });
  let matchTiers: MatchTier[] | null = null;
  if (matchRow) {
    const parsed = matchTiersSchema.safeParse(matchRow.tiers);
    matchTiers = parsed.success ? parsed.data : null;
  }

  const limits = computeContributionLimits({
    contributions,
    year,
    age,
    iraAccountIds: accounts.filter((a) => looksLikeIra(a.name)).map((a) => a.id),
    annualSalary: assumptions.currentAnnualSalary,
    matchTiers,
    matchAnnualCap: matchRow?.annualCap ? toNumber(matchRow.annualCap) : null,
  });

  // Growth attribution over the last year of snapshot history, restricted to
  // the retirement/investment accounts. lookbackStart is inclusive and today
  // is treated as the exclusive-on-both-sides upper bound inside
  // attributeGrowth (it expands occurrences to addUTCDays(endDate, -1) and
  // filters contributions with date < endDate), so passing `today` here as
  // endDate is correct - it does not need to be pushed forward a day.
  const lookbackStart = addUTCMonths(today, -GROWTH_LOOKBACK_MONTHS);
  const history =
    (await getNetWorthHistory(
      userId,
      Math.max(1, Math.round((today.getTime() - lookbackStart.getTime()) / 86_400_000) + 1),
      todayISO,
    )) ?? [];
  const startBalance = history.length > 0 ? history[0].assets : totalBalance;
  const growth =
    history.length > 0
      ? attributeGrowth({
          startBalance,
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
    currentMonthlyContribution,
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
