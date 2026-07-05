// Shared resolution of the transactions list's time-window query params
// (m / range / from / to), used by both the page and the CSV export route so
// the two can never disagree about what a given URL means.

import {
  addUTCMonths, endOfUTCMonth, formatMonthDayYear, isoDay, monthLabel, parseISODay, startOfUTCMonth,
} from "@/lib/dates";

const RANGES = new Set(["month", "3m", "12m", "ytd", "all", "custom"]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface RangeParams {
  m?: string;
  range?: string;
  from?: string;
  to?: string;
}

export interface ResolvedRange {
  range: string;
  monthISO: string;
  startISO: string;
  endISO: string;
  rangeLabel: string;
  /** Filename-friendly identifier for the window, e.g. "2026-06" or "ytd". */
  slug: string;
}

export function resolveTransactionsRange(params: RangeParams, todayISO: string): ResolvedRange {
  const { m, range: rangeParam, from, to } = params;
  let range = RANGES.has(rangeParam ?? "") ? (rangeParam as string) : "month";
  // A valid from/to pair forces custom mode regardless of the range param.
  const hasCustom = ISO_DAY.test(from ?? "") && ISO_DAY.test(to ?? "") && (from as string) <= (to as string);
  if (range === "custom" && !hasCustom) range = "month";
  if (hasCustom) range = "custom";

  const today = parseISODay(todayISO);
  const monthStr = /^\d{4}-\d{2}$/.test(m ?? "") ? (m as string) : todayISO.slice(0, 7);
  const monthFirst = startOfUTCMonth(parseISODay(`${monthStr}-01`));
  const monthISO = isoDay(monthFirst);

  let startISO: string;
  let endISO: string;
  let rangeLabel: string;
  switch (range) {
    case "3m":
      startISO = isoDay(startOfUTCMonth(addUTCMonths(today, -2)));
      endISO = isoDay(endOfUTCMonth(today));
      rangeLabel = "Last 3 months";
      break;
    case "12m":
      startISO = isoDay(startOfUTCMonth(addUTCMonths(today, -11)));
      endISO = isoDay(endOfUTCMonth(today));
      rangeLabel = "Last 12 months";
      break;
    case "ytd":
      startISO = `${todayISO.slice(0, 4)}-01-01`;
      endISO = isoDay(endOfUTCMonth(today));
      rangeLabel = `${todayISO.slice(0, 4)} year to date`;
      break;
    case "all":
      startISO = "1970-01-01";
      endISO = "2999-12-31";
      rangeLabel = "All time";
      break;
    case "custom":
      startISO = from as string;
      endISO = to as string;
      rangeLabel = `${formatMonthDayYear(startISO)} – ${formatMonthDayYear(endISO)}`;
      break;
    default:
      startISO = monthISO;
      endISO = isoDay(endOfUTCMonth(monthFirst));
      rangeLabel = monthLabel(monthFirst);
  }

  const slug =
    range === "month" ? monthISO.slice(0, 7)
    : range === "custom" ? `${startISO}-to-${endISO}`
    : range;

  return { range, monthISO, startISO, endISO, rangeLabel, slug };
}
