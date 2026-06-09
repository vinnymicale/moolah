import { formatUSD } from "@/lib/money";

/**
 * A signed, color-coded money amount: green "+1,200" for income, red "-45" for
 * expense, and a neutral, unsigned figure for transfers (which are cash-flow
 * neutral). Pass `format` to swap the currency formatter, e.g. the compact
 * calendar one. `className` is appended for per-context sizing/layout.
 */
export function Amount({
  type,
  amount,
  isTransfer = false,
  format = formatUSD,
  className = "",
}: {
  type: "INCOME" | "EXPENSE";
  amount: number;
  isTransfer?: boolean;
  format?: (n: number) => string;
  className?: string;
}) {
  const tone = isTransfer ? "text-muted" : type === "INCOME" ? "text-income" : "text-expense";
  const sign = isTransfer ? "" : type === "INCOME" ? "+" : "-";
  return <span className={`tabular-nums ${tone} ${className}`}>{sign}{format(amount)}</span>;
}
