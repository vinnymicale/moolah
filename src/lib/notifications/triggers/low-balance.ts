import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import type { TriggerDef } from "../types";

export const lowBalance: TriggerDef = {
  id: "low-balance",
  label: "Low account balance",
  description: "An account's balance dropped below a dollar threshold.",
  group: "transactions",
  modes: ["sweep", "event"],
  severity: "critical",
  paramsSchema: z.object({
    amount: z.number().min(0).default(100),
    accountId: z.string().min(1, "Pick an account."),
  }),
  paramFields: [
    { key: "amount", label: "Threshold ($)", kind: "number", min: 0 },
    { key: "accountId", label: "Account", kind: "select", optionsFrom: "account" },
  ],
  variables: [
    { name: "account", description: "Account name" },
    { name: "balance", description: "Current balance" },
    { name: "threshold", description: "Configured threshold" },
  ],
  defaultTemplate: {
    title: "{{account}} balance is low",
    body: "{{account}} is at {{balance}}, below your {{threshold}} threshold.",
  },
  sampleVars: { account: "Checking", balance: "$87.20", threshold: "$100.00" },
  async evaluate(ctx) {
    const { amount, accountId } = ctx.params as { amount: number; accountId: string };
    const account = await prisma.financialAccount.findFirst({
      where: { id: accountId, userId: ctx.userId, archived: false },
      select: { id: true, name: true, currentBalance: true },
    });
    if (!account) return [];
    const balance = toNumber(account.currentBalance);
    if (balance >= amount) return [];
    return [
      {
        dedupeKey: `low-balance:${account.id}:${ctx.todayISO}`,
        vars: { account: account.name, balance: formatUSD(balance), threshold: formatUSD(amount) },
      },
    ];
  },
};
