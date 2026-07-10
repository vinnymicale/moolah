import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { expandOccurrences } from "@/lib/recurrence";
import { addUTCDays, isoDay, parseISODay } from "@/lib/dates";
import type { TriggerDef, TriggerEvent } from "../types";

const DAY_MS = 86_400_000;

export const recurringMissing: TriggerDef = {
  id: "recurring-missing",
  label: "Expected recurring charge missing",
  description: "A recurring rule's expected occurrence has no matching transaction past a grace period.",
  group: "bills",
  modes: ["sweep"],
  severity: "info",
  paramsSchema: z.object({
    graceDays: z.number().int().min(1).max(14).default(3),
  }),
  paramFields: [{ key: "graceDays", label: "Grace days", kind: "number", min: 1, max: 14 }],
  variables: [
    { name: "name", description: "Recurring rule description" },
    { name: "expected_date", description: "Expected date (YYYY-MM-DD)" },
    { name: "days_late", description: "Days past the expected date" },
  ],
  defaultTemplate: {
    title: "{{name}} hasn't shown up",
    body: "{{name}} was expected {{expected_date}} ({{days_late}} days ago) and hasn't appeared.",
  },
  sampleVars: { name: "Netflix", expected_date: "2026-07-01", days_late: "8" },
  async evaluate(ctx) {
    const { graceDays } = ctx.params as { graceDays: number };
    const today = parseISODay(ctx.todayISO);
    const cutoff = addUTCDays(today, -graceDays);
    const windowStart = addUTCDays(today, -60);
    const rules = await prisma.recurringRule.findMany({
      where: { userId: ctx.userId, archived: false },
      select: {
        id: true, description: true, frequency: true, interval: true,
        startDate: true, endDate: true, dayOfMonth: true, weekday: true,
      },
    });
    const events: TriggerEvent[] = [];
    for (const rule of rules) {
      const expected = expandOccurrences(rule, windowStart, cutoff).at(-1);
      if (!expected) continue;
      const matched = await prisma.transaction.findFirst({
        where: {
          userId: ctx.userId,
          recurringRuleId: rule.id,
          deletedAt: null,
          date: { gte: addUTCDays(expected, -4) },
        },
        select: { id: true },
      });
      if (matched) continue;
      events.push({
        dedupeKey: `recurring-missing:${rule.id}:${isoDay(expected)}`,
        vars: {
          name: rule.description,
          expected_date: isoDay(expected),
          days_late: String(Math.round((today.getTime() - expected.getTime()) / DAY_MS)),
        },
      });
    }
    return events;
  },
};
