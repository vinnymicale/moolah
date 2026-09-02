import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { expandVersioned } from "@/lib/recurrence";
import { addUTCDays, isoDay, parseISODay } from "@/lib/dates";
import type { TriggerDef, TriggerEvent } from "../types";

const DAY_MS = 86_400_000;

export const paycheckMissing: TriggerDef = {
  id: "paycheck-missing",
  label: "Expected paycheck missing",
  description: "A recurring income deposit hasn't landed past its grace period.",
  group: "bills",
  modes: ["sweep"],
  severity: "warning",
  paramsSchema: z.object({ graceDays: z.number().int().min(1).max(14).default(3) }),
  paramFields: [{ key: "graceDays", label: "Grace days", kind: "number", min: 1, max: 14 }],
  variables: [
    { name: "name", description: "Recurring rule description" },
    { name: "expected_date", description: "Expected date (YYYY-MM-DD)" },
    { name: "days_late", description: "Days past the expected date" },
  ],
  defaultTemplate: {
    title: "{{name}} hasn't arrived",
    body: "{{name}} was expected {{expected_date}} ({{days_late}} days ago) and hasn't posted.",
  },
  sampleVars: { name: "Paycheck", expected_date: "2026-07-01", days_late: "8" },
  async evaluate(ctx) {
    const { graceDays } = ctx.params as { graceDays: number };
    const today = parseISODay(ctx.todayISO);
    const cutoff = addUTCDays(today, -graceDays);
    const windowStart = addUTCDays(today, -60);
    const rules = await prisma.recurringRule.findMany({
      // Type is per-version now, so filter on any income version and confirm
      // against the version that actually covers the expected occurrence.
      where: { userId: ctx.userId, archived: false, versions: { some: { type: "INCOME" } } },
      select: { id: true, description: true, versions: { orderBy: { effectiveFrom: "asc" } } },
    });
    const events: TriggerEvent[] = [];
    for (const rule of rules) {
      const last = expandVersioned(rule.versions, windowStart, cutoff).at(-1);
      if (!last || last.version.type !== "INCOME") continue;
      const expected = last.date;
      const matched = await prisma.transaction.findFirst({
        where: {
          userId: ctx.userId, recurringRuleId: rule.id, deletedAt: null, isTransfer: false,
          date: { gte: addUTCDays(expected, -4) },
        },
        select: { id: true },
      });
      if (matched) continue;
      events.push({
        dedupeKey: `paycheck-missing:${rule.id}:${isoDay(expected)}`,
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
