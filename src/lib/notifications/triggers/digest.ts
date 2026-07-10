import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUpcoming } from "@/lib/calendar";
import { getBudgetMonth } from "@/lib/queries/budgets";
import { formatUSD, toNumber } from "@/lib/money";
import { addUTCDays, isoDay, parseISODay } from "@/lib/dates";
import type { TriggerDef } from "../types";

/** Most recent scheduled send time at or before `now`, in server-local time
 *  (scheduled sends have no request cookie to read a user timezone from). */
export function latestSlot(
  now: Date,
  frequency: "daily" | "weekly",
  hour: number,
  weekday: number,
): Date {
  const slot = new Date(now);
  slot.setHours(hour, 0, 0, 0);
  if (frequency === "daily") {
    if (slot.getTime() > now.getTime()) slot.setDate(slot.getDate() - 1);
    return slot;
  }
  while (slot.getDay() !== weekday) slot.setDate(slot.getDate() - 1);
  if (slot.getTime() > now.getTime()) slot.setDate(slot.getDate() - 7);
  return slot;
}

async function buildSummary(userId: string, todayISO: string, days: number): Promise<string | null> {
  const today = parseISODay(todayISO);
  const horizon = addUTCDays(today, days);

  const [upcomingAll, cards, budgetLines] = await Promise.all([
    getUpcoming(userId, todayISO, days),
    prisma.financialAccount.findMany({
      where: { userId, archived: false, type: "CREDIT_CARD", nextPaymentDueDate: { not: null } },
      select: { name: true, nextPaymentDueDate: true, lastStatementBalance: true, isOverdue: true },
    }),
    getBudgetMonth(userId, todayISO),
  ]);

  const bills = upcomingAll.filter((u) => u.type === "EXPENSE");

  const cardLines: string[] = [];
  for (const card of cards) {
    const due = card.nextPaymentDueDate!;
    const amount = toNumber(card.lastStatementBalance ?? 0);
    if (amount <= 0) continue;
    const past = due.getTime() < today.getTime();
    if (past && card.isOverdue !== true) continue;
    if (!past && due.getTime() > horizon.getTime()) continue;
    cardLines.push(
      past
        ? `${card.name}: ${formatUSD(amount)} OVERDUE (was due ${isoDay(due)})`
        : `${card.name}: ${formatUSD(amount)} due ${isoDay(due)}`,
    );
  }

  const overBudget = budgetLines.filter((l) => l.effectiveLimit > 0 && l.actual > l.effectiveLimit);

  const sections: string[] = [];
  if (cardLines.length) sections.push(`Cards:\n${cardLines.join("\n")}`);
  if (bills.length) {
    sections.push(
      `Upcoming bills (next ${days} days):\n${bills
        .map((b) => `${b.date} ${b.description} ${formatUSD(b.amount)}`)
        .join("\n")}`,
    );
  }
  if (overBudget.length) {
    sections.push(
      `Over budget:\n${overBudget
        .map((l) => `${l.name}: ${formatUSD(l.actual)} of ${formatUSD(l.effectiveLimit)}`)
        .join("\n")}`,
    );
  }
  return sections.length ? sections.join("\n\n") : null;
}

export const digest: TriggerDef = {
  id: "digest",
  label: "Scheduled digest",
  description: "A daily or weekly summary of upcoming bills, card due dates, and over-budget categories.",
  group: "digest",
  modes: ["sweep"],
  severity: "info",
  paramsSchema: z.object({
    frequency: z.enum(["daily", "weekly"]).default("daily"),
    weekday: z.number().int().min(0).max(6).default(1),
    hour: z.number().int().min(0).max(23).default(8),
    days: z.number().int().min(1).max(30).default(3),
  }),
  paramFields: [
    {
      key: "frequency", label: "Frequency", kind: "select",
      options: [
        { value: "daily", label: "Daily" },
        { value: "weekly", label: "Weekly" },
      ],
    },
    {
      key: "weekday", label: "Weekday (weekly only)", kind: "select",
      options: [
        { value: "0", label: "Sunday" }, { value: "1", label: "Monday" },
        { value: "2", label: "Tuesday" }, { value: "3", label: "Wednesday" },
        { value: "4", label: "Thursday" }, { value: "5", label: "Friday" },
        { value: "6", label: "Saturday" },
      ],
      optional: true,
    },
    { key: "hour", label: "Hour (0-23, server time)", kind: "number", min: 0, max: 23 },
    { key: "days", label: "Bill look-ahead days", kind: "number", min: 1, max: 30 },
  ],
  variables: [{ name: "summary", description: "The rendered digest body" }],
  defaultTemplate: {
    title: "Moolah digest",
    body: "{{summary}}",
  },
  sampleVars: {
    summary: "Upcoming bills (next 3 days):\n2026-07-12 Netflix $15.49",
  },
  async evaluate(ctx) {
    const { frequency, weekday, hour, days } = ctx.params as {
      frequency: "daily" | "weekly"; weekday: number; hour: number; days: number;
    };
    const slot = latestSlot(ctx.now, frequency, hour, weekday);
    const slotKey = `${slot.getFullYear()}-${String(slot.getMonth() + 1).padStart(2, "0")}-${String(slot.getDate()).padStart(2, "0")}`;
    const summary = await buildSummary(ctx.userId, ctx.todayISO, days);
    if (summary === null) return [];
    return [{ dedupeKey: `digest:${frequency}:${slotKey}`, vars: { summary } }];
  },
};
