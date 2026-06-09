export type TxnTypeOpt = "INCOME" | "EXPENSE";
export type StatusOpt = "CLEARED" | "PENDING";

export interface SavedFilter {
  name: string;
  search: string;
  types: TxnTypeOpt[];
  statuses: StatusOpt[];
  cats: string[];
  accts: string[];
}

/** Split a comma-separated query value into a Set of non-empty tokens. */
export function toSet(csv: string): Set<string> {
  return new Set(csv.split(",").map((s) => s.trim()).filter(Boolean));
}

/** Quote a CSV field if it contains a comma, quote, or newline. */
export function csvField(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Last day-of-month (zero-padded) for an ISO month like "2026-06-01". */
export function endOfMonthDay(monthISO: string): string {
  const [y, m] = monthISO.slice(0, 7).split("-").map(Number);
  return String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0");
}
