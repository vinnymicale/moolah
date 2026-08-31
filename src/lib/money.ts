// Money helpers.
//
// Money is stored in Postgres as DECIMAL(14,2). At the application boundary we
// convert to plain JS numbers (dollars). Personal-finance magnitudes are far
// within the safe-integer range when expressed in cents, so we do all summation
// in integer cents to avoid binary-float drift, then convert back to dollars.

import { z } from "zod";

export type MoneyInput = number | string | { toString(): string } | null | undefined;

/**
 * Normalise a user-typed or pasted money string to something Number() accepts.
 *
 * Amounts copied out of a bank or brokerage page rarely arrive bare: they carry
 * a currency symbol, thousands separators, non-breaking spaces left over from
 * the HTML, and occasionally accounting parentheses for a negative. Stripping
 * all of that is friendlier than rejecting a paste the user can plainly read as
 * a number.
 *
 * Returns null when what's left isn't a single well-formed number, so callers
 * can report bad input rather than silently treating it as zero.
 */
export function normalizeMoneyString(raw: string): number | null {
  let s = raw.replace(/[\s\u00a0\u202f]/g, "");
  if (s === "") return null;

  // Accounting notation: (1,234.56) means -1,234.56.
  let negative = false;
  const parens = /^\((.*)\)$/.exec(s);
  if (parens) {
    negative = true;
    s = parens[1];
  }

  s = s.replace(/[$€£¥]|USD/gi, "").replace(/,/g, "");

  // A leading sign is fine, but only one, and only here.
  const signed = /^([+-])(.*)$/.exec(s);
  if (signed) {
    if (signed[1] === "-") negative = !negative;
    s = signed[2];
  }

  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Zod schema for user-typed money amounts. Accepts pasted formatting (commas,
 * currency symbols, parentheses) and reports anything genuinely unparseable in
 * language a user can act on, rather than Zod's "expected number, received NaN".
 */
export const moneyInput = z.union([
  z.number(),
  z.string().transform((v, ctx) => {
    const n = normalizeMoneyString(v);
    if (n === null) {
      ctx.addIssue({ code: "custom", message: `"${v}" isn't a valid amount.` });
      return z.NEVER;
    }
    return n;
  }),
]);

/** Convert a Prisma Decimal / string / number to a JS number (dollars). */
export function toNumber(value: MoneyInput): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const raw = typeof value === "string" ? value : value.toString();
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Dollars -> integer cents (rounded). */
export function toCents(value: MoneyInput): number {
  return Math.round(toNumber(value) * 100);
}

/** Integer cents -> dollars. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** Sum a list of money values without float drift. Returns dollars. */
export function sumMoney(values: MoneyInput[]): number {
  const cents = values.reduce<number>((acc, v) => acc + toCents(v), 0);
  return fromCents(cents);
}

/** Add money values, returning dollars. */
export function addMoney(...values: MoneyInput[]): number {
  return sumMoney(values);
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Format as US currency, e.g. -$1,234.56 */
export function formatUSD(value: MoneyInput): string {
  return usd.format(toNumber(value));
}

/** Format as whole-dollar currency, e.g. $1,235 (handy for big net-worth figures). */
export function formatUSDWhole(value: MoneyInput): string {
  return usdWhole.format(Math.round(toNumber(value)));
}

/** Signed format with an explicit leading +/- (used for transaction deltas). */
export function formatSigned(value: MoneyInput): string {
  const n = toNumber(value);
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}${usd.format(Math.abs(n))}`;
}
