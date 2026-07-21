import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import { addUTCDays, endOfUTCMonth, parseISODay, startOfUTCMonth } from "@/lib/dates";
import type { TriggerDef } from "../types";

async function sumFor(userId: string, type: "INCOME" | "EXPENSE", start: Date, end: Date): Promise<number> {
  const agg = await prisma.transaction.aggregate({
    _sum: { amount: true },
    where: { userId, deletedAt: null, isTransfer: false, type, date: { gte: start, lte: end } },
  });
  return toNumber(agg._sum.amount ?? 0);
}

export const monthEndCashflow: TriggerDef = {
  id: "month-end-cashflow",
  label: "Month-end cashflow",
  description: "A net income-minus-expenses summary on the last day of the month.",
  group: "digest",
  modes: ["sweep"],
  severity: "info",
  paramsSchema: z.object({}),
  paramFields: [],
  variables: [
    { name: "income", description: "Total income this month" },
    { name: "expenses", description: "Total expenses this month" },
    { name: "net", description: "Income minus expenses" },
    { name: "month", description: "Month (YYYY-MM)" },
  ],
  defaultTemplate: {
    title: "{{month}} cashflow: {{net}}",
    body: "Income {{income}}, expenses {{expenses}}, net {{net}} for {{month}}.",
  },
  sampleVars: { income: "$5,000.00", expenses: "$3,200.00", net: "$1,800.00", month: "2026-07" },
  async evaluate(ctx) {
    const today = parseISODay(ctx.todayISO);
    const monthEnd = endOfUTCMonth(today);
    if (isoDayLocal(today) !== isoDayLocal(monthEnd)) return [];
    const monthStart = startOfUTCMonth(today);
    const rangeEnd = addUTCDays(monthEnd, 1);
    const income = await sumFor(ctx.userId, "INCOME", monthStart, rangeEnd);
    const expenses = await sumFor(ctx.userId, "EXPENSE", monthStart, rangeEnd);
    const month = ctx.todayISO.slice(0, 7);
    return [
      {
        dedupeKey: `month-end-cashflow:${month}`,
        vars: {
          income: formatUSD(income),
          expenses: formatUSD(expenses),
          net: formatUSD(income - expenses),
          month,
        },
      },
    ];
  },
};

function isoDayLocal(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
