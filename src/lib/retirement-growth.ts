// Growth attribution: how much of a balance change was money the user added
// versus market movement.
//
//   marketReturn = balanceDelta - contributionsInPeriod
//
// The weakness of manual tracking is a forgotten contribution, which silently
// inflates apparent market return. So we reconcile recorded contributions
// against what the active schedules expected: any month that expected money and
// recorded none is reported as a gap. The number is still shown - it is just
// labelled soft, with the gap months named so the user can fix the data.

import { addUTCDays, isoDay } from "./dates";
import { sumMoney } from "./money";
import { expandOccurrences } from "./recurrence";
import type { ContributionRecord, ScheduledContribution } from "./retirement-types";

export interface GrowthAttribution {
  balanceDelta: number;
  contributed: number;
  marketReturn: number;
  /** Market return as a percentage of the starting balance; null when it was zero. */
  marketReturnPercent: number | null;
  /** Months ("YYYY-MM") that expected a contribution but recorded none. */
  gapMonths: string[];
  confident: boolean;
}

export function attributeGrowth({
  startBalance,
  endBalance,
  contributions,
  schedules,
  startDate,
  endDate,
}: {
  startBalance: number;
  endBalance: number;
  contributions: ContributionRecord[];
  schedules: ScheduledContribution[];
  startDate: Date;
  endDate: Date;
}): GrowthAttribution {
  const inPeriod = contributions.filter(
    (c) => c.date.getTime() >= startDate.getTime() && c.date.getTime() < endDate.getTime(),
  );
  const contributed = sumMoney(inPeriod.map((c) => c.amount));
  const balanceDelta = Math.round((endBalance - startBalance) * 100) / 100;
  const marketReturn = Math.round((balanceDelta - contributed) * 100) / 100;

  // expandOccurrences is inclusive of both endpoints, but the contribution
  // filter above is half-open on endDate. Expand up to the day before endDate
  // so an occurrence landing exactly on endDate doesn't get counted as
  // expected while a same-day contribution is excluded from recorded - that
  // mismatch would produce a phantom gap month.
  const occurrenceRangeEnd = addUTCDays(endDate, -1);

  // Months where a schedule expected money.
  const expectedMonths = new Set<string>();
  for (const s of schedules) {
    for (const d of expandOccurrences(
      {
        frequency: s.frequency,
        interval: s.interval,
        startDate: s.startDate,
        endDate: s.endDate,
        dayOfMonth: s.dayOfMonth,
        weekday: s.weekday,
      },
      startDate,
      occurrenceRangeEnd,
    )) {
      expectedMonths.add(isoDay(d).slice(0, 7));
    }
  }

  const recordedMonths = new Set(inPeriod.map((c) => isoDay(c.date).slice(0, 7)));
  const gapMonths = [...expectedMonths].filter((m) => !recordedMonths.has(m)).sort();

  return {
    balanceDelta,
    contributed,
    marketReturn,
    marketReturnPercent: startBalance > 0 ? (marketReturn / startBalance) * 100 : null,
    gapMonths,
    confident: gapMonths.length === 0,
  };
}
