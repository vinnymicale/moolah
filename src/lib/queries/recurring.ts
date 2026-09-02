import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/money";
import { addUTCMonths, isoDay, parseISODay, startOfUTCMonth } from "@/lib/dates";
import { flattenVersion, versionsInclude } from "@/lib/recurring-versions";
import { currentVersion } from "@/lib/recurrence";
import {
  detectRecurringCandidates,
  type RecurringSuggestion,
  type TxnForDetect,
} from "@/lib/recurring-suggestions";
import type { TxnType, Frequency } from "@/generated/prisma/enums";

export type { RecurringSuggestion } from "@/lib/recurring-suggestions";

/**
 * A rule flattened to the version in force today, which is what the list UI and
 * the edit form show. `versions` carries the whole history so the form can
 * render it and prefill an effective date.
 */
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
  /** Newest first, so the UI can list history without re-sorting. */
  versions: RecurringVersionDTO[];
}

export interface RecurringVersionDTO {
  id: string;
  effectiveFrom: string;
  type: TxnType;
  amount: number;
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

export async function getRecurringRules(
  userId: string,
  includeArchived = false,
  todayISO?: string,
): Promise<RecurringDTO[]> {
  const rows = await prisma.recurringRule.findMany({
    where: { userId, ...(includeArchived ? {} : { archived: false }) },
    orderBy: { createdAt: "asc" },
    include: versionsInclude,
  });
  const asOf = todayISO ? parseISODay(todayISO) : new Date();
  return rows.map((r) => {
    const active = flattenVersion(currentVersion(r.versions, asOf));
    return {
      id: r.id,
      description: r.description,
      type: active.type,
      amount: active.amount,
      note: active.note,
      accountId: active.accountId,
      categoryId: active.categoryId,
      frequency: active.frequency,
      interval: active.interval,
      dayOfMonth: active.dayOfMonth,
      weekday: active.weekday,
      // The series began with the earliest version, not the active one.
      startDate: isoDay(r.versions[0].startDate),
      endDate: active.endDate ? isoDay(active.endDate) : null,
      versions: [...r.versions].reverse().map((v) => {
        const f = flattenVersion(v);
        return {
          id: v.id,
          effectiveFrom: isoDay(f.effectiveFrom),
          type: f.type,
          amount: f.amount,
          note: f.note,
          accountId: f.accountId,
          categoryId: f.categoryId,
          frequency: f.frequency,
          interval: f.interval,
          dayOfMonth: f.dayOfMonth,
          weekday: f.weekday,
          startDate: isoDay(f.startDate),
          endDate: f.endDate ? isoDay(f.endDate) : null,
        };
      }),
    };
  });
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
