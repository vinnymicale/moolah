import { z } from "zod";
import { getUpcoming } from "@/lib/calendar";
import { formatUSD } from "@/lib/money";
import { parseISODay } from "@/lib/dates";
import type { TriggerDef } from "../types";

const DAY_MS = 86_400_000;

export const billDue: TriggerDef = {
  id: "bill-due",
  label: "Bill coming up",
  description: "A recurring or scheduled expense is due within N days.",
  group: "bills",
  modes: ["sweep"],
  severity: "info",
  paramsSchema: z.object({
    days: z.number().int().min(1).max(30).default(3),
  }),
  paramFields: [{ key: "days", label: "Days ahead", kind: "number", min: 1, max: 30 }],
  variables: [
    { name: "name", description: "Bill description" },
    { name: "amount", description: "Bill amount" },
    { name: "due_date", description: "Due date (YYYY-MM-DD)" },
    { name: "days", description: "Days until due" },
  ],
  defaultTemplate: {
    title: "{{name}} due in {{days}} days",
    body: "{{name}} ({{amount}}) is due {{due_date}}.",
  },
  sampleVars: { name: "Netflix", amount: "$15.49", due_date: "2026-07-12", days: "3" },
  async evaluate(ctx) {
    const { days } = ctx.params as { days: number };
    const today = parseISODay(ctx.todayISO);
    const upcoming = await getUpcoming(ctx.userId, ctx.todayISO, days);
    return upcoming
      .filter((u) => u.type === "EXPENSE")
      .map((u) => ({
        dedupeKey: `bill-due:${u.description}:${u.date}`,
        vars: {
          name: u.description,
          amount: formatUSD(u.amount),
          due_date: u.date,
          days: String(Math.round((parseISODay(u.date).getTime() - today.getTime()) / DAY_MS)),
        },
      }));
  },
};
