// The retirement projection engine.
//
// Walks month by month from today to the target retirement age, compounding the
// balance and adding scheduled contributions along the way.
//
// Results are in today's dollars. A nominal "$3.2M at 65" says nothing about
// what it buys, and the retirement target is expressed in today's dollars too,
// so both sides have to match. We deflate by using a real rate of return
// (Fisher relation) rather than deflating at the end, which keeps every
// intermediate point directly comparable to the target line.

import { addUTCMonths, isoDay, parseISODay } from "./dates";
import { expandOccurrences } from "./recurrence";
import {
  monthlyRateFromAnnual,
  type RetirementAssumptions,
  type ScheduledContribution,
} from "./retirement-types";

export interface ProjectionPoint {
  date: string;
  /** Balance in today's dollars. */
  balance: number;
  /** Cumulative contributions made since today, in today's dollars. */
  contributed: number;
}

export interface ProjectionResult {
  points: ProjectionPoint[];
  finalBalance: number;
  totalContributed: number;
  /** finalBalance - totalContributed - startingBalance. */
  totalGrowth: number;
  monthsToRetirement: number;
}

/**
 * Months from today until the user reaches targetRetirementAge.
 *
 * Uses the birth year only (we never ask for a birth date), so this treats the
 * retirement date as January of the year they turn the target age. Zero when
 * that year is already here or past.
 */
function monthsUntilRetirement(a: RetirementAssumptions, today: Date): number {
  const retirementYear = a.birthYear + a.targetRetirementAge;
  const months = (retirementYear - today.getUTCFullYear()) * 12 - today.getUTCMonth();
  return Math.max(0, months);
}

/**
 * Project the retirement portfolio forward to the target age.
 *
 * Set includeContributions to false for the Coast FIRE trajectory: the same
 * walk with contributions suppressed, answering "what if I never add another
 * dollar?".
 */
export function projectRetirement({
  assumptions,
  startingBalance,
  schedules,
  todayISO,
  includeContributions = true,
}: {
  assumptions: RetirementAssumptions;
  startingBalance: number;
  schedules: ScheduledContribution[];
  todayISO: string;
  includeContributions?: boolean;
}): ProjectionResult {
  const today = parseISODay(todayISO);
  const months = monthsUntilRetirement(assumptions, today);

  if (months === 0) {
    return {
      points: [],
      finalBalance: startingBalance,
      totalContributed: 0,
      totalGrowth: 0,
      monthsToRetirement: 0,
    };
  }

  // Real return via the Fisher relation, so every point is in today's dollars.
  const realAnnual =
    ((1 + assumptions.expectedReturn / 100) / (1 + assumptions.inflationRate / 100) - 1) * 100;
  const monthlyRate = monthlyRateFromAnnual(realAnnual);

  // Total contribution landing in each month, keyed by "YYYY-MM".
  const horizon = addUTCMonths(today, months);
  const contributionByMonth = new Map<string, number>();
  if (includeContributions) {
    for (const s of schedules) {
      const occurrences = expandOccurrences(
        {
          frequency: s.frequency,
          interval: s.interval,
          startDate: s.startDate,
          endDate: s.endDate,
          dayOfMonth: s.dayOfMonth,
          weekday: s.weekday,
        },
        today,
        horizon,
      );
      for (const d of occurrences) {
        const key = isoDay(d).slice(0, 7);
        contributionByMonth.set(key, (contributionByMonth.get(key) ?? 0) + s.amount);
      }
    }
  }

  const points: ProjectionPoint[] = [];
  let balance = startingBalance;
  let contributed = 0;

  for (let m = 1; m <= months; m++) {
    const monthDate = addUTCMonths(today, m);
    const added = contributionByMonth.get(isoDay(monthDate).slice(0, 7)) ?? 0;

    // Grow first, then add the month's contribution, so a contribution does not
    // earn a return in the month it arrives.
    balance = balance * (1 + monthlyRate) + added;
    contributed += added;

    points.push({
      date: isoDay(monthDate),
      balance: Math.round(balance * 100) / 100,
      contributed: Math.round(contributed * 100) / 100,
    });
  }

  const finalBalance = Math.round(balance * 100) / 100;
  const totalContributed = Math.round(contributed * 100) / 100;

  return {
    points,
    finalBalance,
    totalContributed,
    totalGrowth: Math.round((finalBalance - totalContributed - startingBalance) * 100) / 100,
    monthsToRetirement: months,
  };
}
