import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import { addUTCDays, daysBetween } from "@/lib/dates";
import type { TriggerDef, TriggerEvent } from "../types";

export const duplicateCharge: TriggerDef = {
  id: "duplicate-charge",
  label: "Possible duplicate charge",
  description: "A new expense matches an earlier one with the same merchant and amount.",
  group: "transactions",
  modes: ["event"],
  severity: "warning",
  paramsSchema: z.object({ withinDays: z.number().int().min(1).max(30).default(3) }),
  paramFields: [{ key: "withinDays", label: "Within days", kind: "number", min: 1, max: 30 }],
  variables: [
    { name: "merchant", description: "Transaction description" },
    { name: "amount", description: "Charge amount" },
    { name: "account", description: "Account name" },
    { name: "days_apart", description: "Days between the two charges" },
  ],
  defaultTemplate: {
    title: "Possible duplicate: {{merchant}}",
    body: "{{merchant}} charged {{amount}} again on {{account}}, {{days_apart}} day(s) after an identical charge.",
  },
  sampleVars: { merchant: "Spotify", amount: "$9.99", account: "Checking", days_apart: "1" },
  async evaluate(ctx) {
    const { withinDays } = ctx.params as { withinDays: number };
    if (!ctx.event || ctx.event.newTransactionIds.length === 0) return [];
    const txns = await prisma.transaction.findMany({
      where: {
        id: { in: ctx.event.newTransactionIds },
        userId: ctx.userId, deletedAt: null, isTransfer: false, type: "EXPENSE",
        dedupIgnored: false,
      },
      select: { id: true, description: true, amount: true, date: true, account: { select: { name: true } } },
    });
    const events: TriggerEvent[] = [];
    for (const t of txns) {
      const prior = await prisma.transaction.findFirst({
        where: {
          userId: ctx.userId, deletedAt: null, isTransfer: false, dedupIgnored: false,
          description: t.description, amount: t.amount,
          id: { notIn: ctx.event.newTransactionIds },
          date: { gte: addUTCDays(t.date, -withinDays), lte: t.date },
        },
        select: { id: true, date: true },
        orderBy: { date: "desc" },
      });
      if (!prior) continue;
      const daysApart = daysBetween(prior.date, t.date);
      events.push({
        dedupeKey: `duplicate-charge:${t.id}`,
        vars: {
          merchant: t.description,
          amount: formatUSD(toNumber(t.amount)),
          account: t.account?.name ?? "Unlinked",
          days_apart: String(daysApart),
        },
      });
    }
    return events;
  },
};
