// Calendar-date helpers.
//
// Every "date" in this app represents a *calendar day* with no meaningful time
// component. We normalise all of them to midnight UTC so that arithmetic is
// deterministic and free of daylight-saving / timezone drift. Form inputs
// arrive as "YYYY-MM-DD" strings and are parsed with `parseISODay`.

/** Midnight-UTC Date for the calendar day of the given Date/string. */
export function toUTCDay(input: Date | string): Date {
  if (typeof input === "string") return parseISODay(input);
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

/** Parse a "YYYY-MM-DD" string to midnight UTC. */
export function parseISODay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

/** Format a Date as "YYYY-MM-DD" using its UTC calendar day. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * "YYYY-MM-DD" for today in the *local* zone. For client-side form defaults
 * where the user expects their own calendar day, not UTC. Server code wanting
 * the user's day should use userTodayISO() (reads the tz cookie) instead.
 */
export function localTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Last day of the current local-zone month, e.g. "Jun 30". Client-side label. */
export function localMonthEndLabel(): string {
  const d = new Date();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function addUTCDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/** Add months, clamping the day to the last day of the target month. */
export function addUTCMonths(d: Date, n: number): Date {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + n;
  const day = d.getUTCDate();
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = daysInMonth(targetYear, targetMonth);
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
}

export function addUTCYears(d: Date, n: number): Date {
  return addUTCMonths(d, n * 12);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function startOfUTCMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function endOfUTCMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

export function sameUTCDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate();
}

export const MS_PER_DAY = 86_400_000;

/** Whole days from a to b (b - a). Both are normalised to UTC day first. */
export function daysBetween(a: Date, b: Date): number {
  const ms = toUTCDay(b).getTime() - toUTCDay(a).getTime();
  return Math.round(ms / MS_PER_DAY);
}

/** Whole days from now until an ISO calendar day, negative once it's in the past. */
export function daysUntilDate(iso: string): number {
  return Math.ceil((new Date(`${iso}T00:00:00Z`).getTime() - Date.now()) / MS_PER_DAY);
}

export function isBefore(a: Date, b: Date): boolean {
  return a.getTime() < b.getTime();
}

export function isAfter(a: Date, b: Date): boolean {
  return a.getTime() > b.getTime();
}

/** Inclusive clamp helper. */
export function withinRange(d: Date, start: Date, end: Date): boolean {
  return d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthLabel(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Human-readable formatters for "YYYY-MM-DD" calendar days. All render in UTC
// so the displayed day matches the stored day regardless of the viewer's zone.
function formatISODay(iso: string, options: Intl.DateTimeFormatOptions): string {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...options });
}

/** "Jun 9" */
export function formatMonthDay(iso: string): string {
  return formatISODay(iso, { month: "short", day: "numeric" });
}

/** "Mon, Jun 9" */
export function formatWeekdayMonthDay(iso: string): string {
  return formatISODay(iso, { weekday: "short", month: "short", day: "numeric" });
}

/** "Jun 9, 2026" */
export function formatMonthDayYear(iso: string): string {
  return formatISODay(iso, { month: "short", day: "numeric", year: "numeric" });
}

/** "Mon, Jun 9, 2026" */
export function formatWeekdayMonthDayYear(iso: string): string {
  return formatISODay(iso, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/**
 * The 6-week (42 day) grid covering the month of `d`, starting on Sunday.
 * Returns midnight-UTC days. Used by the calendar view.
 */
export function monthGrid(d: Date): Date[] {
  const first = startOfUTCMonth(d);
  const startWeekday = first.getUTCDay(); // 0=Sun
  const gridStart = addUTCDays(first, -startWeekday);
  return Array.from({ length: 42 }, (_, i) => addUTCDays(gridStart, i));
}
