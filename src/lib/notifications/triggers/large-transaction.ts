import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import type { TriggerDef } from "../types";

export const largeTransaction: TriggerDef = {
  id: "large-transaction",
  label: "Large transaction",
  description: "A new expense at or above a dollar threshold.",
  group: "transactions",
  modes: ["event"],
  severity: "warning",
  paramsSchema: z.object({
    amount: z.number().min(1).default(500),
    accountId: z.string().optional(),
  }),
  paramFields: [
    { key: "amount", label: "Amount ($)", kind: "number", min: 1 },
    { key: "accountId", label: "Account (all if empty)", kind: "select", optionsFrom: "account", optional: true },
  ],
  variables: [
    { name: "merchant", description: "Transaction description" },
    { name: "amount", description: "Transaction amount" },
    { name: "account", description: "Account name" },
    { name: "category", description: "Category name" },
  ],
  defaultTemplate: {
    title: "Large transaction: {{merchant}}",
    body: "{{merchant}} charged {{amount}} on {{account}} ({{category}}).",
  },
  sampleVars: { merchant: "Best Buy", amount: "$899.99", account: "Checking", category: "Shopping" },
  async evaluate(ctx) {
    const { amount, accountId } = ctx.params as { amount: number; accountId?: string };
    if (!ctx.event || ctx.event.newTransactionIds.length === 0) return [];
    const txns = await prisma.transaction.findMany({
      where: {
        id: { in: ctx.event.newTransactionIds },
        userId: ctx.userId,
        deletedAt: null,
        isTransfer: false,
        type: "EXPENSE",
        amount: { gte: amount },
        ...(accountId ? { accountId } : {}),
      },
      select: {
        id: true, description: true, amount: true,
        account: { select: { name: true } },
        category: { select: { name: true } },
      },
    });
    return txns.map((t) => ({
      dedupeKey: `large-transaction:${t.id}`,
      vars: {
        merchant: t.description,
        amount: formatUSD(toNumber(t.amount)),
        account: t.account?.name ?? "Unlinked",
        category: t.category?.name ?? "Uncategorized",
      },
    }));
  },
};
