import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/money";
import { addUTCMonths, isoDay, parseISODay, startOfUTCMonth } from "@/lib/dates";
import {
  detectRecurringCandidates,
  type RecurringSuggestion,
  type TxnForDetect,
} from "@/lib/recurring-suggestions";
import type { TxnType, Frequency } from "@/generated/prisma/enums";

export type { RecurringSuggestion } from "@/lib/recurring-suggestions";

export interface RecurringDTO {
  id: string;
  type: TxnType;
  amount: number;
  description: string;
  note: string | null;
  accountId: string | null;
  categoryId: string | null;
  frequency: Frequency;
  interval: number;
  dayOfMonth: number | null;
  weekday: number | null;
  startDate: string;
  endDate: string | null;
}

export async function getRecurringRules(userId: string, includeArchived = false): Promise<RecurringDTO[]> {
  const rows = await prisma.recurringRule.findMany({
    where: { userId, ...(includeArchived ? {} : { archived: false }) },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    amount: toNumber(r.amount),
    description: r.description,
    note: r.note,
    accountId: r.accountId,
    categoryId: r.categoryId,
    frequency: r.frequency,
    interval: r.interval,
    dayOfMonth: r.dayOfMonth,
    weekday: r.weekday,
    startDate: isoDay(r.startDate),
    endDate: r.endDate ? isoDay(r.endDate) : null,
  }));
}

/**
 * Suggest recurring rules by scanning the last ~8 months of transactions for
 * regularly-repeating charges that aren't already covered by a rule.
 */
export async function getRecurringSuggestions(userId: string, todayISO: string): Promise<RecurringSuggestion[]> {
  const since = startOfUTCMonth(addUTCMonths(parseISODay(todayISO), -8));

  const [txns, rules] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId, deletedAt: null, date: { gte: since } },
      select: { date: true, description: true, amount: true, type: true, categoryId: true, accountId: true, recurringRuleId: true },
      orderBy: { date: "asc" },
    }),
    prisma.recurringRule.findMany({ where: { userId }, select: { description: true } }),
  ]);

  // Include both the user-named rule descriptions AND the raw bank descriptions
  // of transactions already linked to a rule. This catches cases where a rule
  // was manually named differently from the bank string (e.g. rule "Gym
  // Membership" with linked transactions "LA FITNESS").
  const linkedDescriptions = [...new Set(
    txns.filter((t) => t.recurringRuleId).map((t) => t.description)
  )];
  const existingDescriptions = [
    ...rules.map((r) => r.description),
    ...linkedDescriptions,
  ];

  const mapped: TxnForDetect[] = txns.map((t) => ({
    date: isoDay(t.date),
    description: t.description,
    amount: toNumber(t.amount),
    type: t.type,
    categoryId: t.categoryId,
    accountId: t.accountId,
    recurringRuleId: t.recurringRuleId,
  }));

  return detectRecurringCandidates(mapped, { existingDescriptions });
}
