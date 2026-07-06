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
  asExpense = false,
  format = formatUSD,
  className = "",
}: {
  type: "INCOME" | "EXPENSE";
  amount: number;
  isTransfer?: boolean;
  /** Render a transfer with normal expense styling - used for credit-card
   * statement payments, which are real cash leaving the bank. */
  asExpense?: boolean;
  format?: (n: number) => string;
  className?: string;
}) {
  const transferTone = isTransfer && !asExpense;
  const tone = transferTone ? "text-muted" : type === "INCOME" ? "text-income" : "text-expense";
  const sign = transferTone ? "" : type === "INCOME" ? "+" : "-";
  return <span className={`money ${tone} ${className}`}>{sign}{format(amount)}</span>;
}
