import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import type { TriggerDef, TriggerEvent } from "../types";

export const ccUtilization: TriggerDef = {
  id: "cc-utilization",
  label: "High credit utilization",
  description: "A credit card's balance crossed a percent of its limit.",
  group: "transactions",
  modes: ["sweep", "event"],
  severity: "warning",
  paramsSchema: z.object({
    percent: z.number().int().min(1).max(100).default(30),
    accountId: z.string().optional(),
  }),
  paramFields: [
    { key: "percent", label: "Utilization (%)", kind: "number", min: 1, max: 100 },
    { key: "accountId", label: "Card (all if empty)", kind: "select", optionsFrom: "account", optional: true },
  ],
  variables: [
    { name: "account", description: "Card name" },
    { name: "percent", description: "Current utilization percent" },
    { name: "balance", description: "Current balance" },
    { name: "limit", description: "Credit limit" },
  ],
  defaultTemplate: {
    title: "{{account}} utilization at {{percent}}%",
    body: "{{account}}: {{balance}} of a {{limit}} limit.",
  },
  sampleVars: { account: "Sapphire", percent: "32", balance: "$3,200.00", limit: "$10,000.00" },
  async evaluate(ctx) {
    const { percent, accountId } = ctx.params as { percent: number; accountId?: string };
    const cards = await prisma.financialAccount.findMany({
      where: {
        userId: ctx.userId,
        archived: false,
        type: "CREDIT_CARD",
        creditLimit: { not: null },
        ...(accountId ? { id: accountId } : {}),
      },
      select: { id: true, name: true, currentBalance: true, creditLimit: true },
    });
    const events: TriggerEvent[] = [];
    for (const card of cards) {
      const limit = toNumber(card.creditLimit!);
      if (limit <= 0) continue;
      const balance = toNumber(card.currentBalance);
      const util = (balance / limit) * 100;
      if (util < percent) continue;
      events.push({
        dedupeKey: `cc-utilization:${card.id}:${ctx.todayISO}`,
        vars: {
          account: card.name,
          percent: String(Math.round(util)),
          balance: formatUSD(balance),
          limit: formatUSD(limit),
        },
      });
    }
    return events;
  },
};
