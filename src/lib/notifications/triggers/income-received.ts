import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import type { TriggerDef } from "../types";

export const incomeReceived: TriggerDef = {
  id: "income-received",
  label: "Income received",
  description: "A new income transaction landed.",
  group: "transactions",
  modes: ["event"],
  severity: "info",
  paramsSchema: z.object({
    minAmount: z.number().min(0).default(0),
    accountId: z.string().optional(),
  }),
  paramFields: [
    { key: "minAmount", label: "Minimum amount ($)", kind: "number", min: 0 },
    { key: "accountId", label: "Account (all if empty)", kind: "select", optionsFrom: "account", optional: true },
  ],
  variables: [
    { name: "merchant", description: "Transaction description" },
    { name: "amount", description: "Amount received" },
    { name: "account", description: "Account name" },
  ],
  defaultTemplate: {
    title: "Income received: {{amount}}",
    body: "{{merchant}} deposited {{amount}} to {{account}}.",
  },
  sampleVars: { merchant: "Acme Payroll", amount: "$2,400.00", account: "Checking" },
  async evaluate(ctx) {
    const { minAmount, accountId } = ctx.params as { minAmount: number; accountId?: string };
    if (!ctx.event || ctx.event.newTransactionIds.length === 0) return [];
    const txns = await prisma.transaction.findMany({
      where: {
        id: { in: ctx.event.newTransactionIds },
        userId: ctx.userId,
        deletedAt: null,
        isTransfer: false,
        type: "INCOME",
        amount: { gte: minAmount },
        ...(accountId ? { accountId } : {}),
      },
      select: { id: true, description: true, amount: true, account: { select: { name: true } } },
    });
    return txns.map((t) => ({
      dedupeKey: `income-received:${t.id}`,
      vars: {
        merchant: t.description,
        amount: formatUSD(toNumber(t.amount)),
        account: t.account?.name ?? "Unlinked",
      },
    }));
  },
};
