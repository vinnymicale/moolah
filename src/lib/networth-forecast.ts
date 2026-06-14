// Net-worth forecasting.
//
// Projects net worth forward from today by walking active recurring rules and
// applying their signed cash effect (INCOME +, EXPENSE -) day by day on top of
// the current net. It is a straight-line cash-flow projection: recurring rules
// are the only forward signal we model, so a month with more recurring income
// than expense lifts net worth and vice versa. One point is emitted per month
// boundary so the chart stays light while still showing the trajectory.
//
// This is intentionally simpler than the per-account snapshot history: we don't
// know how individual asset balances will move (market returns, etc.), only the
// scheduled cash flows the user has told us about.

import { prisma } from "./prisma";
import { toNumber } from "./money";
import { addUTCDays, addUTCMonths, isoDay, parseISODay } from "./dates";
import { expandOccurrences } from "./recurrence";

export interface ForecastPoint {
  date: string;
  net: number;
}

/**
 * Project net worth forward `months` from `todayISO`. Returns one point per
 * month end (plus nothing for today itself - the caller anchors the line to the
 * last historical point). An empty array is returned when there are no active
 * recurring rules, since there is then nothing to project.
 */
export async function forecastNetWorth(
  userId: string,
  currentNet: number,
  months: number,
  todayISO: string,
): Promise<ForecastPoint[]> {
  const today = parseISODay(todayISO);
  const horizon = addUTCMonths(today, months);

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
  if (rules.length === 0) return [];

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
  if (deltaByDay.size === 0) return [];

  // Walk month by month, accumulating every delta that lands on or before each
  // month boundary.
  const points: ForecastPoint[] = [];
  let running = currentNet;
  let cursor = windowStart;
  for (let m = 1; m <= months; m++) {
    const boundary = addUTCMonths(today, m);
    for (let day = cursor; day.getTime() <= boundary.getTime(); day = addUTCDays(day, 1)) {
      running += deltaByDay.get(isoDay(day)) ?? 0;
    }
    cursor = addUTCDays(boundary, 1);
    points.push({ date: isoDay(boundary), net: Math.round(running * 100) / 100 });
  }
  return points;
}
