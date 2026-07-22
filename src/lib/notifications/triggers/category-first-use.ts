import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import { parseISODay, startOfUTCMonth } from "@/lib/dates";
import type { TriggerDef, TriggerEvent } from "../types";

export const categoryFirstUse: TriggerDef = {
  id: "category-first-use",
  label: "First charge in a category this month",
  description: "A new expense in a category you haven't used yet this month.",
  group: "transactions",
  modes: ["event"],
  severity: "info",
  paramsSchema: z.object({ accountId: z.string().optional() }),
  paramFields: [
    { key: "accountId", label: "Account (all if empty)", kind: "select", optionsFrom: "account", optional: true },
  ],
  variables: [
    { name: "category", description: "Category name" },
    { name: "merchant", description: "Transaction description" },
    { name: "amount", description: "Charge amount" },
  ],
  defaultTemplate: {
    title: "First {{category}} charge this month",
    body: "{{merchant}} ({{amount}}) is your first {{category}} spend this month.",
  },
  sampleVars: { category: "Travel", merchant: "Delta", amount: "$240.00" },
  async evaluate(ctx) {
    const { accountId } = ctx.params as { accountId?: string };
    if (!ctx.event || ctx.event.newTransactionIds.length === 0) return [];
    const monthStart = startOfUTCMonth(parseISODay(ctx.todayISO));
    const month = ctx.todayISO.slice(0, 7);
    const txns = await prisma.transaction.findMany({
      where: {
        id: { in: ctx.event.newTransactionIds },
        userId: ctx.userId, deletedAt: null, isTransfer: false, type: "EXPENSE",
        ...(accountId ? { accountId } : {}),
      },
      select: { id: true, description: true, amount: true, categoryId: true, category: { select: { name: true } } },
    });
    const events: TriggerEvent[] = [];
    const seen = new Set<string>();
    for (const t of txns) {
      if (!t.categoryId) continue;
      if (seen.has(t.categoryId)) continue;
      const prior = await prisma.transaction.count({
        where: {
          userId: ctx.userId, deletedAt: null, isTransfer: false,
          categoryId: t.categoryId,
          date: { gte: monthStart },
          id: { notIn: ctx.event.newTransactionIds },
        },
      });
      if (prior > 0) continue;
      seen.add(t.categoryId);
      events.push({
        dedupeKey: `category-first-use:${t.categoryId}:${month}`,
        vars: {
          category: t.category?.name ?? "Uncategorized",
          merchant: t.description,
          amount: formatUSD(toNumber(t.amount)),
        },
      });
    }
    return events;
  },
};
