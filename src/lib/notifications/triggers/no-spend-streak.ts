import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { addUTCDays, isoDay, parseISODay } from "@/lib/dates";
import type { TriggerDef } from "../types";

export const noSpendStreak: TriggerDef = {
  id: "no-spend-streak",
  label: "No-spend streak",
  description: "You've gone several days with no spending.",
  group: "transactions",
  modes: ["sweep"],
  severity: "info",
  paramsSchema: z.object({ days: z.number().int().min(2).default(3) }),
  paramFields: [{ key: "days", label: "Days with no spend", kind: "number", min: 2 }],
  variables: [
    { name: "days", description: "Length of the streak" },
    { name: "since", description: "Date the streak started (YYYY-MM-DD)" },
  ],
  defaultTemplate: {
    title: "{{days}}-day no-spend streak",
    body: "No spending since {{since}}. Nice.",
  },
  sampleVars: { days: "3", since: "2026-07-06" },
  async evaluate(ctx) {
    const { days } = ctx.params as { days: number };
    const today = parseISODay(ctx.todayISO);
    const windowStart = addUTCDays(today, -days);
    const recent = await prisma.transaction.findFirst({
      where: {
        userId: ctx.userId, deletedAt: null, isTransfer: false, type: "EXPENSE",
        date: { gte: windowStart },
      },
      select: { id: true },
    });
    if (recent) return [];
    return [
      {
        dedupeKey: `no-spend-streak:${isoDay(windowStart)}`,
        vars: { days: String(days), since: isoDay(windowStart) },
      },
    ];
  },
};
