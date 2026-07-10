import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import type { TriggerDef, TriggerEvent } from "../types";

export const newMerchant: TriggerDef = {
  id: "new-merchant",
  label: "First charge from a new merchant",
  description: "A new expense from a merchant with no prior transactions.",
  group: "transactions",
  modes: ["event"],
  severity: "info",
  paramsSchema: z.object({
    accountId: z.string().optional(),
  }),
  paramFields: [
    { key: "accountId", label: "Account (all if empty)", kind: "select", optionsFrom: "account", optional: true },
  ],
  variables: [
    { name: "merchant", description: "Merchant name" },
    { name: "amount", description: "Transaction amount" },
    { name: "account", description: "Account name" },
  ],
  defaultTemplate: {
    title: "New merchant: {{merchant}}",
    body: "First charge from {{merchant}}: {{amount}} on {{account}}.",
  },
  sampleVars: { merchant: "Blue Bottle", amount: "$6.50", account: "Checking" },
  async evaluate(ctx) {
    const { accountId } = ctx.params as { accountId?: string };
    if (!ctx.event || ctx.event.newTransactionIds.length === 0) return [];
    const txns = await prisma.transaction.findMany({
      where: {
        id: { in: ctx.event.newTransactionIds },
        userId: ctx.userId,
        deletedAt: null,
        isTransfer: false,
        type: "EXPENSE",
        ...(accountId ? { accountId } : {}),
      },
      select: { id: true, description: true, amount: true, account: { select: { name: true } } },
    });
    const events: TriggerEvent[] = [];
    for (const t of txns) {
      const prior = await prisma.transaction.count({
        where: {
          userId: ctx.userId,
          deletedAt: null,
          description: t.description,
          id: { notIn: ctx.event.newTransactionIds },
        },
      });
      if (prior > 0) continue;
      events.push({
        dedupeKey: `new-merchant:${t.description.toLowerCase()}`,
        vars: {
          merchant: t.description,
          amount: formatUSD(toNumber(t.amount)),
          account: t.account?.name ?? "Unlinked",
        },
      });
    }
    return events;
  },
};
