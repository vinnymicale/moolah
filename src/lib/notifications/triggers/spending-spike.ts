import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import { addUTCDays, parseISODay } from "@/lib/dates";
import type { TriggerDef } from "../types";

async function expenseSum(userId: string, start: Date, end: Date): Promise<number> {
  const agg = await prisma.transaction.aggregate({
    _sum: { amount: true },
    where: {
      userId, deletedAt: null, isTransfer: false, type: "EXPENSE",
      date: { gte: start, lt: end },
    },
  });
  return toNumber(agg._sum.amount ?? 0);
}

export const spendingSpike: TriggerDef = {
  id: "spending-spike",
  label: "Spending spike",
  description: "This week's spending is well above your recent weekly average.",
  group: "transactions",
  modes: ["sweep"],
  severity: "info",
  paramsSchema: z.object({ percent: z.number().int().min(10).default(50) }),
  paramFields: [{ key: "percent", label: "Over average by (%)", kind: "number", min: 10 }],
  variables: [
    { name: "this_week", description: "Spending in the last 7 days" },
    { name: "average", description: "Average weekly spend over the prior 4 weeks" },
    { name: "percent", description: "Percent above average" },
  ],
  defaultTemplate: {
    title: "Spending is up this week",
    body: "You've spent {{this_week}} in the last 7 days, {{percent}}% over your {{average}} weekly average.",
  },
  sampleVars: { this_week: "$620.00", average: "$400.00", percent: "55" },
  async evaluate(ctx) {
    const { percent } = ctx.params as { percent: number };
    const today = parseISODay(ctx.todayISO);
    const weekStart = addUTCDays(today, -7);
    const priorStart = addUTCDays(today, -35);
    const thisWeek = await expenseSum(ctx.userId, weekStart, today);
    const priorTotal = await expenseSum(ctx.userId, priorStart, weekStart);
    if (priorTotal <= 0) return [];
    const average = priorTotal / 4;
    const over = ((thisWeek - average) / average) * 100;
    if (over < percent) return [];
    return [
      {
        dedupeKey: `spending-spike:${ctx.todayISO}`,
        vars: { this_week: formatUSD(thisWeek), average: formatUSD(average), percent: String(Math.round(over)) },
      },
    ];
  },
};
