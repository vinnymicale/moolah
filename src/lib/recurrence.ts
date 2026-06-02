// Recurrence engine.
//
// Expands a RecurringRule into concrete occurrence dates within a window. This
// is what lets the calendar show *expected* (not-yet-happened) transactions on
// future days and powers the cash-flow projection.

import {
  addUTCDays,
  addUTCMonths,
  addUTCYears,
  daysInMonth,
  toUTCDay,
  withinRange,
} from "./dates";

export type Frequency = "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "YEARLY";

export interface RuleLike {
  frequency: Frequency;
  /** Every N units of the frequency. Defaults to 1. */
  interval?: number | null;
  startDate: Date | string;
  endDate?: Date | string | null;
  /** Anchor day-of-month (1-31) for MONTHLY/YEARLY. Falls back to startDate's day. */
  dayOfMonth?: number | null;
  /** Anchor weekday (0=Sun..6=Sat) for WEEKLY/BIWEEKLY. Falls back to startDate's weekday. */
  weekday?: number | null;
}

// Hard ceiling so a misconfigured rule can never loop forever.
const MAX_OCCURRENCES = 10_000;

/**
 * Return all occurrence days (midnight UTC) of `rule` that fall within
 * [rangeStart, rangeEnd] inclusive. Results are sorted ascending.
 */
export function expandOccurrences(
  rule: RuleLike,
  rangeStart: Date,
  rangeEnd: Date,
): Date[] {
  const start = toUTCDay(rule.startDate);
  const end = toUTCDay(rangeEnd);
  const ruleEnd = rule.endDate ? toUTCDay(rule.endDate) : null;
  const hardEnd = ruleEnd && ruleEnd.getTime() < end.getTime() ? ruleEnd : end;
  const winStart = toUTCDay(rangeStart);
  const interval = Math.max(1, rule.interval ?? 1);

  const out: Date[] = [];
  const push = (d: Date) => {
    if (withinRange(d, winStart, hardEnd)) out.push(d);
  };

  switch (rule.frequency) {
    case "DAILY": {
      const step = interval;
      // Fast-forward to the first occurrence at/after winStart.
      let cursor = start;
      if (cursor.getTime() < winStart.getTime()) {
        const gap = Math.ceil(
          (winStart.getTime() - cursor.getTime()) / 86_400_000 / step,
        );
        cursor = addUTCDays(cursor, gap * step);
      }
      for (let i = 0; i < MAX_OCCURRENCES && cursor.getTime() <= hardEnd.getTime(); i++) {
        push(cursor);
        cursor = addUTCDays(cursor, step);
      }
      break;
    }
    case "WEEKLY":
    case "BIWEEKLY": {
      const weeks = rule.frequency === "BIWEEKLY" ? 2 * interval : interval;
      const stepDays = 7 * weeks;
      // Honour an explicit weekday anchor by shifting the start to it.
      let anchor = start;
      if (rule.weekday != null) {
        const diff = (rule.weekday - start.getUTCDay() + 7) % 7;
        anchor = addUTCDays(start, diff);
      }
      let cursor = anchor;
      if (cursor.getTime() < winStart.getTime()) {
        const gap = Math.ceil(
          (winStart.getTime() - cursor.getTime()) / 86_400_000 / stepDays,
        );
        cursor = addUTCDays(cursor, gap * stepDays);
      }
      for (let i = 0; i < MAX_OCCURRENCES && cursor.getTime() <= hardEnd.getTime(); i++) {
        push(cursor);
        cursor = addUTCDays(cursor, stepDays);
      }
      break;
    }
    case "MONTHLY": {
      const dom = rule.dayOfMonth ?? start.getUTCDate();
      let cursor = start;
      for (let i = 0; i < MAX_OCCURRENCES && cursor.getTime() <= hardEnd.getTime(); i++) {
        const occ = onDayOfMonth(cursor, dom);
        push(occ);
        cursor = addUTCMonths(cursor, interval);
      }
      break;
    }
    case "YEARLY": {
      const dom = rule.dayOfMonth ?? start.getUTCDate();
      let cursor = start;
      for (let i = 0; i < MAX_OCCURRENCES && cursor.getTime() <= hardEnd.getTime(); i++) {
        const occ = onDayOfMonth(cursor, dom);
        push(occ);
        cursor = addUTCYears(cursor, interval);
      }
      break;
    }
  }

  out.sort((a, b) => a.getTime() - b.getTime());
  return out;
}

/** The given day-of-month within the month of `d`, clamped to the month length. */
function onDayOfMonth(d: Date, dom: number): Date {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const last = daysInMonth(year, month);
  return new Date(Date.UTC(year, month, Math.min(Math.max(1, dom), last)));
}

const FREQ_LABELS: Record<Frequency, string> = {
  DAILY: "day",
  WEEKLY: "week",
  BIWEEKLY: "2 weeks",
  MONTHLY: "month",
  YEARLY: "year",
};

/** Human label, e.g. "Every month" / "Every 2 weeks" / "Every 3 days". */
export function describeFrequency(frequency: Frequency, interval = 1): string {
  if (interval <= 1) {
    return frequency === "BIWEEKLY" ? "Every 2 weeks" : `Every ${FREQ_LABELS[frequency]}`;
  }
  if (frequency === "BIWEEKLY") return `Every ${2 * interval} weeks`;
  return `Every ${interval} ${FREQ_LABELS[frequency]}s`;
}
