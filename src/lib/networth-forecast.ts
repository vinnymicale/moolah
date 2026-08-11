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
// To correct for that we calibrate against realized history. The snapshot line
// already records what net worth actually did, so we derive an observed monthly
// rate of change from it and compare that to the rate the rules imply. When the
// rules are more optimistic than reality we scale them down to match. Rules
// still drive the *shape* of the line (timing of large scheduled flows), while
// realized history sets its overall slope.
//
// Calibration depends on the realized rate being measured over real snapshots.
// The history feed pads days with no snapshot as net = 0, so the leading pad
// has to be dropped before measuring; otherwise a user who started snapshotting
// recently looks like they went from $0 to their full balance in days, the
// realized rate dwarfs the rules rate, and the damping never engages - exactly
// the steep line this calibration exists to prevent.

import { prisma } from "./prisma";
import { toNumber } from "./money";
import { addUTCDays, addUTCMonths, isoDay, parseISODay } from "./dates";
import { expandOccurrences } from "./recurrence";
import { getNetWorthHistory } from "./snapshots";

export interface ForecastPoint {
  date: string;
  net: number;
}

/** How the slope of the returned line was arrived at. */
export type ForecastBasis = "rules" | "calibrated";

export interface ForecastResult {
  points: ForecastPoint[];
  basis: ForecastBasis;
  /** Net change per month the rules on their own imply. */
  rulesMonthly: number;
  /** Net change per month actually observed, or null when history is too thin. */
  realizedMonthly: number | null;
}

// Realized rate is measured over this many days of trailing history. Long
// enough to smooth out a single unusual month, short enough to reflect current
// habits rather than a job change from a year ago.
const CALIBRATION_DAYS = 120;

// Below this many days of history the realized rate is too noisy to trust, and
// we fall back to the raw rules projection.
const MIN_CALIBRATION_DAYS = 45;

/**
 * Average net change per month observed in the snapshot line, or null when
 * there is not enough history to measure one.
 *
 * Uses first and last point rather than a fitted slope: net worth lines are
 * dominated by their endpoints, and a regression over a noisy daily series
 * mostly buys complexity rather than accuracy here.
 */
export function realizedMonthlyRate(
  history: { date: string; net: number }[],
): number | null {
  if (history.length < 2) return null;
  // getNetWorthHistory returns one point per requested day whether or not a
  // snapshot exists, and days before the user's first snapshot come back as
  // net = 0 - absence of data rather than a real zero net worth. Measuring from
  // one of those invents a jump from $0 to the whole balance, which reads as
  // enormous growth and suppresses calibration entirely. Skip the leading
  // zero-run so the rate is measured only across genuinely observed days.
  //
  // Only a *leading* run is skipped: a line that legitimately crosses zero
  // mid-history keeps every point after its first non-zero observation.
  const firstReal = history.findIndex((p) => p.net !== 0);
  if (firstReal === -1) return null;
  const observed = history.slice(firstReal);
  if (observed.length < 2) return null;
  const first = observed[0];
  const last = observed[observed.length - 1];
  const spanDays =
    (parseISODay(last.date).getTime() - parseISODay(first.date).getTime()) / 86_400_000;
  if (spanDays < MIN_CALIBRATION_DAYS) return null;
  return (last.net - first.net) / (spanDays / 30.44);
}

/**
 * Scale factor to apply to rules-derived deltas so the projection's slope
 * matches what has actually been happening.
 *
 * Only ever damps an over-optimistic projection; we never scale a projection
 * *up* to meet a rosier realized rate. A good recent stretch (a bonus, a market
 * run) is a weak basis for promising the same every month, whereas rules that
 * outrun reality are a known, systematic bias worth correcting.
 */
export function calibrationFactor(
  rulesMonthly: number,
  realizedMonthly: number | null,
): number {
  if (realizedMonthly === null) return 1;
  // Rules predict losing money: already pessimistic, leave it alone.
  if (rulesMonthly <= 0) return 1;
  // Reality is at least as good as the rules predict: no correction needed.
  if (realizedMonthly >= rulesMonthly) return 1;
  // Reality is flat or shrinking while rules predict growth. Damp the growth
  // to nothing rather than going negative, which would overcorrect into an
  // equally unfounded decline.
  if (realizedMonthly <= 0) return 0;
  return realizedMonthly / rulesMonthly;
}

/**
 * Project net worth forward `months` from `todayISO`. Returns one point per
 * month end (plus nothing for today itself - the caller anchors the line to the
 * last historical point). An empty result is returned when there are no active
 * recurring rules, since there is then nothing to project.
 *
 * The slope is calibrated against realized snapshot history where enough of it
 * exists; see the module header for why.
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
    realizedMonthly: null,
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

  const history = await getNetWorthHistory(userId, CALIBRATION_DAYS, todayISO);
  const realizedMonthly = realizedMonthlyRate(history);
  const factor = calibrationFactor(rulesMonthly, realizedMonthly);

  // Walk month by month, accumulating every delta that lands on or before each
  // month boundary.
  const points: ForecastPoint[] = [];
  let running = currentNet;
  let cursor = windowStart;
  for (let m = 1; m <= months; m++) {
    const boundary = addUTCMonths(today, m);
    for (let day = cursor; day.getTime() <= boundary.getTime(); day = addUTCDays(day, 1)) {
      running += (deltaByDay.get(isoDay(day)) ?? 0) * factor;
    }
    cursor = addUTCDays(boundary, 1);
    points.push({ date: isoDay(boundary), net: Math.round(running * 100) / 100 });
  }
  return {
    points,
    basis: factor === 1 ? "rules" : "calibrated",
    rulesMonthly: Math.round(rulesMonthly * 100) / 100,
    realizedMonthly:
      realizedMonthly === null ? null : Math.round(realizedMonthly * 100) / 100,
  };
}
