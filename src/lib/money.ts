// Money helpers.
//
// Money is stored in Postgres as DECIMAL(14,2). At the application boundary we
// convert to plain JS numbers (dollars). Personal-finance magnitudes are far
// within the safe-integer range when expressed in cents, so we do all summation
// in integer cents to avoid binary-float drift, then convert back to dollars.

export type MoneyInput = number | string | { toString(): string } | null | undefined;

/** Convert a Prisma Decimal / string / number to a JS number (dollars). */
export function toNumber(value: MoneyInput): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const n = typeof value === "string" ? Number(value) : Number(value.toString());
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
