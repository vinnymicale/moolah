// Net-worth forecasting.
//
// Projects net worth forward from today by walking active recurring rules and
// applying their signed cash effect (INCOME +, EXPENSE -) day by day on top of
// the current net. One point is emitted per month boundary so the chart stays
// light while still showing the trajectory.
//
// The rules-only version of this was badly biased upward. Recurring income is
// almost always fully modelled (one paycheck rule covers it), while recurring
// expenses are not: groceries, gas, restaurants and one-off spending never
// become rules. So the projection captured most inflows and only some outflows,
// and the gap compounded across the horizon - producing a steep rise for users
// whose net worth had actually been flat for months.
//
// The fix is to model the missing spending rather than to correct for it after
// the fact. unmodelled-cashflow.ts measures, straight from transaction history,
// the average monthly cash flow that no rule accounts for. Adding that residual
// to the rules projection produces a line built entirely from observed cash
// movement: rules supply the *shape* (timing of large scheduled flows) and the
// residual supplies the steady drag of everyday spending.
//
// An earlier version instead damped the slope to match realized net worth. That
// was a fudge factor on top of a known-incomplete model, and it silently failed
// whenever snapshot history was thin. Projecting the real spending is both more
// accurate and easier to explain, so it replaces the damping entirely.
//
// Investment growth is deliberately not modelled. This projects cash in and
// out; balances that move with the market stay flat at today's value rather
// than embedding a market prediction in a budgeting tool.

import { prisma } from "./prisma";
import { toNumber } from "./money";
import { addUTCDays, addUTCMonths, isoDay, parseISODay } from "./dates";
import { expandOccurrences } from "./recurrence";
import { unmodelledMonthlyRate } from "./unmodelled-cashflow";

export interface ForecastPoint {
  date: string;
  net: number;
}

/**
 * How the slope of the returned line was arrived at. "rules" means the rules
 * projected alone, because transaction history was too thin to measure the
 * residual; "cashflow" means observed unmodelled spending is included.
 */
export type ForecastBasis = "rules" | "cashflow";

export interface ForecastResult {
  points: ForecastPoint[];
  basis: ForecastBasis;
  /** Net change per month the rules on their own imply. */
  rulesMonthly: number;
  /**
   * Net change per month from real transactions that no rule models, or null
   * when there is too little history to measure it. Usually negative.
   */
  unmodelledMonthly: number | null;
}

// Unmodelled cash flow is measured over this many days of trailing
// transaction history. Long enough to smooth out a single unusual month, short
// enough to reflect current habits rather than spending from a year ago.
const CASHFLOW_DAYS = 120;

/**
 * Project net worth forward `months` from `todayISO`. Returns one point per
 * month end (plus nothing for today itself - the caller anchors the line to the
 * last historical point). An empty result is returned when there are no active
 * recurring rules, since there is then nothing to project.
 *
 * Unmodelled everyday spending is measured from transaction history and added
 * to the rules projection where enough history exists; see the module header.
 */
export async function forecastNetWorth(
  userId: string,
  currentNet: number,
  months: number,
  todayISO: string,
): Promise<ForecastResult> {
  const today = parseISODay(todayISO);
  const horizon = addUTCMonths(today, months);
  const empty: ForecastResult = {
    points: [],
    basis: "rules",
    rulesMonthly: 0,
    unmodelledMonthly: null,
  };

  const rules = await prisma.recurringRule.findMany({
    where: { userId, archived: false },
    select: {
      frequency: true,
      interval: true,
      startDate: true,
      endDate: true,
      dayOfMonth: true,
      weekday: true,
      amount: true,
      type: true,
    },
  });
  if (rules.length === 0) return empty;

  // Forecast window starts the day after today so we never double-count an event
  // already reflected in the current net.
  const windowStart = addUTCDays(today, 1);

  // Daily signed cash delta keyed by ISO day across the whole horizon.
  const deltaByDay = new Map<string, number>();
  for (const rule of rules) {
    const sign = rule.type === "INCOME" ? 1 : -1;
    const amount = toNumber(rule.amount) * sign;
    const occ = expandOccurrences(
      {
        frequency: rule.frequency,
        interval: rule.interval,
        startDate: rule.startDate,
        endDate: rule.endDate,
        dayOfMonth: rule.dayOfMonth,
        weekday: rule.weekday,
      },
      windowStart,
      horizon,
    );
    for (const d of occ) {
      const iso = isoDay(d);
      deltaByDay.set(iso, (deltaByDay.get(iso) ?? 0) + amount);
    }
  }
  if (deltaByDay.size === 0) return empty;

  // Rate the rules imply on their own, before any correction.
  let totalDelta = 0;
  for (const v of deltaByDay.values()) totalDelta += v;
  const rulesMonthly = totalDelta / months;

  // Spending the rules never captured, measured from real transactions. This is
  // the correction that keeps the line honest; see the module header.
  const cashflowStart = addUTCDays(today, -CASHFLOW_DAYS);
  const txns = await prisma.transaction.findMany({
    where: {
      userId,
      deletedAt: null,
      date: { gte: cashflowStart, lte: today },
    },
    select: {
      date: true,
      type: true,
      amount: true,
      recurringRuleId: true,
      isTransfer: true,
      account: { select: { type: true } },
    },
  });
  const unmodelledMonthly = unmodelledMonthlyRate(
    txns.map((t) => ({
      date: isoDay(t.date),
      type: t.type as "INCOME" | "EXPENSE",
      amount: toNumber(t.amount),
      recurringRuleId: t.recurringRuleId,
      isTransfer: t.isTransfer,
      accountType: t.account?.type ?? null,
    })),
    isoDay(cashflowStart),
    // End exclusive at tomorrow so today's transactions are inside the window.
    isoDay(windowStart),
  );
  // Spread the monthly residual evenly across days: it represents a steady
  // drift of everyday spending, not an event on any particular date.
  const dailyResidual = unmodelledMonthly === null ? 0 : unmodelledMonthly / 30.44;

  // Walk month by month, accumulating every delta that lands on or before each
  // month boundary.
  const points: ForecastPoint[] = [];
  let running = currentNet;
  let cursor = windowStart;
  for (let m = 1; m <= months; m++) {
    const boundary = addUTCMonths(today, m);
    for (let day = cursor; day.getTime() <= boundary.getTime(); day = addUTCDays(day, 1)) {
      running += (deltaByDay.get(isoDay(day)) ?? 0) + dailyResidual;
    }
    cursor = addUTCDays(boundary, 1);
    points.push({ date: isoDay(boundary), net: Math.round(running * 100) / 100 });
  }
  return {
    points,
    basis: unmodelledMonthly === null ? "rules" : "cashflow",
    rulesMonthly: Math.round(rulesMonthly * 100) / 100,
    unmodelledMonthly:
      unmodelledMonthly === null ? null : Math.round(unmodelledMonthly * 100) / 100,
  };
}
