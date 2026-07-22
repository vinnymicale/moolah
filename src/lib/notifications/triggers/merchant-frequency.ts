import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import { addUTCDays, parseISODay } from "@/lib/dates";
import type { TriggerDef, TriggerEvent } from "../types";

export const merchantFrequency: TriggerDef = {
  id: "merchant-frequency-spike",
  label: "Frequent charges from one merchant",
  description: "The same merchant charged you several times in the last week.",
  group: "transactions",
  modes: ["sweep"],
  severity: "info",
  paramsSchema: z.object({ count: z.number().int().min(2).default(4) }),
  paramFields: [{ key: "count", label: "Charges in 7 days", kind: "number", min: 2 }],
  variables: [
    { name: "merchant", description: "Merchant name" },
    { name: "count", description: "Number of charges this week" },
    { name: "total", description: "Total charged this week" },
  ],
  defaultTemplate: {
    title: "{{count}} charges from {{merchant}} this week",
    body: "{{merchant}} charged you {{count}} times in the last 7 days, totaling {{total}}.",
  },
  sampleVars: { merchant: "Uber", count: "5", total: "$74.50" },
  async evaluate(ctx) {
    const { count } = ctx.params as { count: number };
    const weekStart = addUTCDays(parseISODay(ctx.todayISO), -7);
    const rows = await prisma.transaction.groupBy({
      by: ["description"],
      where: {
        userId: ctx.userId, deletedAt: null, isTransfer: false, type: "EXPENSE",
        date: { gte: weekStart },
      },
      _count: { _all: true },
      _sum: { amount: true },
    });
    const events: TriggerEvent[] = [];
    for (const r of rows) {
      if (r._count._all < count) continue;
      events.push({
        dedupeKey: `merchant-frequency-spike:${r.description.toLowerCase()}:${ctx.todayISO}`,
        vars: {
          merchant: r.description,
          count: String(r._count._all),
          total: formatUSD(toNumber(r._sum.amount ?? 0)),
        },
      });
    }
    return events;
  },
};
