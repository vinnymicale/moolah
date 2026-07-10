import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import type { TriggerDef, TriggerEvent } from "../types";

export const recurringPriceChange: TriggerDef = {
  id: "recurring-price-change",
  label: "Recurring charge changed price",
  description: "A synced or imported transaction matched a recurring rule at a different amount.",
  group: "bills",
  modes: ["event"],
  severity: "warning",
  paramsSchema: z.object({
    minPercent: z.number().min(1).max(100).default(10),
  }),
  paramFields: [
    { key: "minPercent", label: "Minimum change (%)", kind: "number", min: 1, max: 100 },
  ],
  variables: [
    { name: "name", description: "Recurring rule description" },
    { name: "old_amount", description: "Expected amount" },
    { name: "new_amount", description: "Charged amount" },
    { name: "change", description: "Signed percent change" },
  ],
  defaultTemplate: {
    title: "{{name}} price changed {{change}}",
    body: "{{name}} charged {{new_amount}}, expected {{old_amount}}.",
  },
  sampleVars: { name: "Netflix", old_amount: "$15.49", new_amount: "$18.99", change: "+23%" },
  async evaluate(ctx) {
    const { minPercent } = ctx.params as { minPercent: number };
    if (!ctx.event || ctx.event.newTransactionIds.length === 0) return [];
    const txns = await prisma.transaction.findMany({
      where: {
        id: { in: ctx.event.newTransactionIds },
        userId: ctx.userId,
        deletedAt: null,
        recurringRuleId: { not: null },
      },
      select: {
        id: true,
        amount: true,
        recurringRule: { select: { id: true, description: true, amount: true } },
      },
    });
    const events: TriggerEvent[] = [];
    for (const t of txns) {
      if (!t.recurringRule) continue;
      const expected = toNumber(t.recurringRule.amount);
      const charged = toNumber(t.amount);
      if (expected <= 0) continue;
      const changePct = ((charged - expected) / expected) * 100;
      if (Math.abs(changePct) < minPercent) continue;
      events.push({
        dedupeKey: `recurring-price-change:${t.recurringRule.id}:${t.id}`,
        vars: {
          name: t.recurringRule.description,
          old_amount: formatUSD(expected),
          new_amount: formatUSD(charged),
          change: `${changePct >= 0 ? "+" : ""}${changePct.toFixed(0)}%`,
        },
      });
    }
    return events;
  },
};
