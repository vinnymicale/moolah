import type { RankMode } from "@/lib/card-rewards/rank";
import type { RewardCurrency } from "@/lib/card-rewards/types";

export function formatRate(rate: number, currency: RewardCurrency): string {
  return currency === "CASH" ? `${rate}%` : `${rate}x`;
}

export function formatScore(
  entry: { rate: number; effectivePct: number },
  mode: RankMode,
  currency: RewardCurrency,
): string {
  return mode === "raw" ? formatRate(entry.rate, currency) : `${entry.effectivePct}%`;
}

const PERIOD_LABELS = { MONTH: "month", QUARTER: "quarter", YEAR: "year" } as const;

export function periodLabel(period: keyof typeof PERIOD_LABELS): string {
  return PERIOD_LABELS[period];
}

export function monthYear(verifiedAsOf: string): string {
  const [year, month] = verifiedAsOf.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
