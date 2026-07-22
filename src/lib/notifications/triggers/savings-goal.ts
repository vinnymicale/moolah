import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import type { TriggerDef } from "../types";

export const savingsGoal: TriggerDef = {
  id: "savings-goal",
  label: "Savings goal reached",
  description: "An account balance reached a target you set.",
  group: "transactions",
  modes: ["sweep"],
  severity: "info",
  paramsSchema: z.object({
    accountId: z.string().min(1, "Pick an account."),
    target: z.number().min(0).default(1000),
  }),
  paramFields: [
    { key: "accountId", label: "Account", kind: "select", optionsFrom: "account" },
    { key: "target", label: "Target ($)", kind: "number", min: 0 },
  ],
  variables: [
    { name: "account", description: "Account name" },
    { name: "balance", description: "Current balance" },
    { name: "target", description: "Target amount" },
  ],
  defaultTemplate: {
    title: "{{account}} hit {{target}}",
    body: "{{account}} reached {{balance}}, past your {{target}} goal.",
  },
  sampleVars: { account: "Savings", balance: "$10,250.00", target: "$10,000.00" },
  async evaluate(ctx) {
    const { accountId, target } = ctx.params as { accountId: string; target: number };
    const account = await prisma.financialAccount.findFirst({
      where: { id: accountId, userId: ctx.userId, archived: false },
      select: { id: true, name: true, currentBalance: true },
    });
    if (!account) return [];
    const balance = toNumber(account.currentBalance);
    if (balance < target) return [];
    return [
      {
        dedupeKey: `savings-goal:${account.id}:${target}`,
        vars: { account: account.name, balance: formatUSD(balance), target: formatUSD(target) },
      },
    ];
  },
};
