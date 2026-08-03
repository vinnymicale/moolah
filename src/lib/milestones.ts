// Derives celebratory "milestone" moments from current financial state. These
// are intentionally stateless - each milestone has a stable id so the UI can
// remember (in localStorage) which ones the user has already dismissed.

import type { SavingsGoalDTO } from "@/lib/queries";

export interface Milestone {
  id: string;
  kind: "networth" | "goal" | "savings" | "retirement";
  title: string;
  detail: string;
}

// Round-number net-worth tiers worth celebrating.
const NET_WORTH_TIERS = [
  1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000,
  1_000_000, 2_000_000, 5_000_000, 10_000_000,
];

// Round-number retirement-balance tiers worth celebrating.
const RETIREMENT_TIERS = [
  10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_000_000,
];

// Salary multiples saved, a common rule-of-thumb benchmark.
const SALARY_MULTIPLES = [1, 2, 3, 5, 8, 10];

export interface RetirementMilestoneInput {
  balance: number;
  annualSalary: number;
  age: number;
  coastFireReached: boolean;
  /**
   * Employer match left unclaimed this year. Treated as fully captured below a
   * dollar, since payroll rounding leaves cents on the table even at a deferral
   * set exactly to the match threshold.
   */
  matchForfeited: number;
}

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
  retirement,
}: {
  netWorth: number;
  goals: SavingsGoalDTO[];
  savingsRate: number | null;
  net: number;
  retirement?: RetirementMilestoneInput;
}): Milestone[] {
  const out: Milestone[] = [];

  // Highest net-worth tier the user has crossed.
  const tier = [...NET_WORTH_TIERS].reverse().find((t) => netWorth >= t);
  if (tier) {
    out.push({
      id: `nw-${tier}`,
      kind: "networth",
      title: `${fmt(tier)} net worth reached!`,
      detail: `Your net worth has crossed ${fmt(tier)}. Keep up the momentum.`,
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

  if (retirement) {
    // Highest retirement-balance tier crossed.
    const rTier = [...RETIREMENT_TIERS].reverse().find((t) => retirement.balance >= t);
    if (rTier) {
      out.push({
        id: `retire-balance-${rTier}`,
        kind: "retirement",
        title: `${fmt(rTier)} saved for retirement`,
        detail: `Your retirement accounts have crossed ${fmt(rTier)}. Compounding does the rest.`,
      });
    }

    // Highest salary multiple saved.
    if (retirement.annualSalary > 0) {
      const multiple = [...SALARY_MULTIPLES]
        .reverse()
        .find((m) => retirement.balance >= retirement.annualSalary * m);
      if (multiple) {
        out.push({
          id: `retire-multiple-${multiple}`,
          kind: "retirement",
          title: `${multiple}x your salary saved`,
          detail: `You've saved ${multiple} times your annual salary for retirement.`,
        });
      }
    }

    if (retirement.coastFireReached) {
      out.push({
        id: "retire-coast-fire",
        kind: "retirement",
        title: "Coast FIRE reached",
        detail:
          "Your current balance alone should reach your retirement target. Everything you add now is ahead of schedule.",
      });
    }

    // Full employer match captured. Only meaningful once something is saved.
    if (retirement.matchForfeited < 1 && retirement.balance > 0) {
      const year = new Date().getUTCFullYear();
      out.push({
        id: `retire-full-match-${year}`,
        kind: "retirement",
        title: "Full employer match captured",
        detail: `You're on pace to claim every dollar of your employer match in ${year}.`,
      });
    }
  }

  return out;
}
