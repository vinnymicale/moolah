// Derives celebratory "milestone" moments from current financial state. These
// are intentionally stateless - each milestone has a stable id so the UI can
// remember (in localStorage) which ones the user has already dismissed.

import type { SavingsGoalDTO } from "@/lib/queries";

export interface Milestone {
  id: string;
  kind: "networth" | "goal" | "savings";
  title: string;
  detail: string;
}

// Round-number net-worth tiers worth celebrating.
const NET_WORTH_TIERS = [
  1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000,
  1_000_000, 2_000_000, 5_000_000, 10_000_000,
];

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${n / 1_000_000}M`;
  if (n >= 1_000) return `$${n / 1_000}k`;
  return `$${n}`;
}

export function computeMilestones({
  netWorth,
  goals,
  savingsRate,
  net,
}: {
  netWorth: number;
  goals: SavingsGoalDTO[];
  savingsRate: number | null;
  net: number;
}): Milestone[] {
  const out: Milestone[] = [];

  // Highest net-worth tier the household has crossed.
  const tier = [...NET_WORTH_TIERS].reverse().find((t) => netWorth >= t);
  if (tier) {
    out.push({
      id: `nw-${tier}`,
      kind: "networth",
      title: `${fmt(tier)} net worth reached!`,
      detail: `Your household net worth has crossed ${fmt(tier)}. Keep up the momentum.`,
    });
  }

  // Completed savings goals.
  for (const g of goals) {
    if (g.targetAmount > 0 && g.currentAmount >= g.targetAmount) {
      out.push({
        id: `goal-${g.id}`,
        kind: "goal",
        title: `Goal reached: ${g.name} 🎉`,
        detail: `You've fully funded "${g.name}". Time to set the next target.`,
      });
    }
  }

  // A strongly positive savings rate this month.
  if (savingsRate !== null && savingsRate >= 20 && net > 0) {
    out.push({
      id: `savings-${new Date().getFullYear()}-${new Date().getMonth() + 1}-${savingsRate >= 50 ? "50" : savingsRate >= 30 ? "30" : "20"}`,
      kind: "savings",
      title: `${savingsRate}% savings rate this month`,
      detail: `You're keeping ${savingsRate}% of your income this month - that's well above average.`,
    });
  }

  return out;
}
