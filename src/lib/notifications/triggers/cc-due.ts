import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import { addUTCDays, isoDay, parseISODay } from "@/lib/dates";
import type { TriggerDef, TriggerEvent } from "../types";

const DAY_MS = 86_400_000;

export const ccDue: TriggerDef = {
  id: "cc-due",
  label: "Credit card payment due",
  description: "A credit card statement payment is due within N days, or the card is overdue.",
  group: "bills",
  modes: ["sweep"],
  severity: "warning",
  paramsSchema: z.object({
    days: z.number().int().min(1).max(30).default(3),
  }),
  paramFields: [{ key: "days", label: "Days ahead", kind: "number", min: 1, max: 30 }],
  variables: [
    { name: "account", description: "Card name" },
    { name: "amount", description: "Statement balance" },
    { name: "due_date", description: "Due date (YYYY-MM-DD)" },
    { name: "days", description: "Days until due (0 when overdue)" },
  ],
  defaultTemplate: {
    title: "{{account}} payment due {{due_date}}",
    body: "{{account}}: {{amount}} statement balance due {{due_date}}.",
  },
  sampleVars: { account: "Sapphire", amount: "$250.00", due_date: "2026-07-12", days: "3" },
  async evaluate(ctx) {
    const { days } = ctx.params as { days: number };
    const today = parseISODay(ctx.todayISO);
    const horizon = addUTCDays(today, days);
    const cards = await prisma.financialAccount.findMany({
      where: { userId: ctx.userId, archived: false, type: "CREDIT_CARD", nextPaymentDueDate: { not: null } },
      select: { id: true, name: true, nextPaymentDueDate: true, lastStatementBalance: true, isOverdue: true },
    });
    const events: TriggerEvent[] = [];
    for (const card of cards) {
      const due = card.nextPaymentDueDate!;
      const amount = toNumber(card.lastStatementBalance ?? 0);
      if (amount <= 0) continue;
      const past = due.getTime() < today.getTime();
      if (past && card.isOverdue !== true) continue;
      if (!past && due.getTime() > horizon.getTime()) continue;
      events.push({
        dedupeKey: `cc-due:${card.id}:${isoDay(due)}`,
        vars: {
          account: card.name,
          amount: formatUSD(amount),
          due_date: isoDay(due),
          days: String(Math.max(0, Math.round((due.getTime() - today.getTime()) / DAY_MS))),
        },
      });
    }
    return events;
  },
};
