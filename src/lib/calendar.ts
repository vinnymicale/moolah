// Calendar assembly: merges concrete transactions with *virtual* occurrences
// projected from recurring rules, then computes the running cash projection for
// every day in the month grid.

import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/money";
import {
  addUTCDays,
  isoDay,
  monthGrid,
  parseISODay,
  toUTCDay,
} from "@/lib/dates";
import { expandOccurrences } from "@/lib/recurrence";
import { projectDailyBalances, type DayProjection, type ProjTxn } from "@/lib/projection";
import { getAccounts } from "@/lib/queries";
import type { TxnType } from "@/generated/prisma/enums";

export interface CalendarEvent {
  /** Concrete transaction id, or a synthetic id for a projected occurrence. */
  id: string;
  date: string;
  type: TxnType;
  amount: number;
  description: string;
  note: string | null;
  categoryId: string | null;
  accountId: string | null;
  cleared: boolean;
  /** True when projected from a recurring rule and not yet materialised. */
  isVirtual: boolean;
  /**
   * True for credit-card payment credits — these reduce the CC balance but are
   * not real income (the actual expenses were already recorded as CC purchases).
   * Excluded from monthIncome / filtered totals.
   */
  isTransfer: boolean;
  recurringRuleId: string | null;
  plaidTransactionId: string | null;
  createdBy: { id: string; name: string | null; image: string | null } | null;
}

export interface CcDueEvent {
  accountId: string;
  accountName: string;
  color: string;
  statementBalance: number | null;
  minimumPayment: number | null;
  dueDate: string; // ISO day
  isOverdue: boolean | null;
}

export interface DayProjectionDTO {
  iso: string;
  income: number;
  expense: number;
  net: number;
  balance: number;
}

export interface CalendarMonth {
  monthISO: string;
  days: string[];
  eventsByDay: Record<string, CalendarEvent[]>;
  ccDueByDay: Record<string, CcDueEvent[]>;
  projection: DayProjectionDTO[];
  projectionByIso: Record<string, DayProjectionDTO>;
  anchorBalance: number;
  todayISO: string;
  monthIncome: number;
  monthExpense: number;
}

export interface UpcomingItem {
  date: string;
  description: string;
  amount: number;
  type: TxnType;
  categoryId: string | null;
  recurring: boolean;
}

/**
 * Expected income/expenses in the next `days` days: not-yet-cleared concrete
 * transactions plus projected recurring occurrences. Drives the dashboard's
 * "upcoming" panel.
 */
export async function getUpcoming(
  householdId: string,
  todayISO: string,
  days = 14,
): Promise<UpcomingItem[]> {
  const start = parseISODay(todayISO);
  const end = addUTCDays(start, days);

  const items: UpcomingItem[] = [];

  const pending = await prisma.transaction.findMany({
    where: { householdId, cleared: false, date: { gte: start, lte: end } },
  });
  for (const t of pending) {
    items.push({
      date: isoDay(t.date),
      description: t.description,
      amount: toNumber(t.amount),
      type: t.type,
      categoryId: t.categoryId,
      recurring: !!t.recurringRuleId,
    });
  }

  const rules = await prisma.recurringRule.findMany({ where: { householdId, archived: false } });
  const materialised = new Set(
    (await prisma.transaction.findMany({
      where: { householdId, recurringRuleId: { not: null }, date: { gte: start, lte: end } },
      select: { recurringRuleId: true, date: true },
    })).map((t) => `${t.recurringRuleId}|${isoDay(t.date)}`),
  );
  for (const rule of rules) {
    for (const occ of expandOccurrences(
      { frequency: rule.frequency, interval: rule.interval, startDate: rule.startDate, endDate: rule.endDate, dayOfMonth: rule.dayOfMonth, weekday: rule.weekday },
      start,
      end,
    )) {
      const iso = isoDay(occ);
      if (materialised.has(`${rule.id}|${iso}`)) continue;
      items.push({
        date: iso,
        description: rule.description,
        amount: toNumber(rule.amount),
        type: rule.type,
        categoryId: rule.categoryId,
        recurring: true,
      });
    }
  }

  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export async function getCalendarMonth(
  householdId: string,
  monthDateISO: string,
  todayISO: string,
): Promise<CalendarMonth> {
  const monthDate = parseISODay(monthDateISO);
  const grid = monthGrid(monthDate);
  const gridStart = grid[0];
  const gridEnd = grid[grid.length - 1];
  const today = parseISODay(todayISO);

  // Projection needs every cash event between the anchor (today) and the window.
  const rangeStart = today.getTime() < gridStart.getTime() ? today : gridStart;
  const rangeEnd = today.getTime() > gridEnd.getTime() ? today : gridEnd;

  const accounts = await getAccounts(householdId);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const anchorBalance = accounts
    .filter((a) => a.includeInCash)
    .reduce((sum, a) => sum + a.currentBalance, 0);

  // Concrete transactions in range.
  const txnRows = await prisma.transaction.findMany({
    where: { householdId, date: { gte: rangeStart, lte: rangeEnd } },
    include: { createdBy: { select: { id: true, name: true, image: true } } },
    orderBy: { date: "asc" },
  });

  const events: CalendarEvent[] = txnRows.map((t) => {
    const acct = t.accountId ? accountById.get(t.accountId) : null;
    return {
      id: t.id,
      date: isoDay(t.date),
      type: t.type,
      amount: toNumber(t.amount),
      description: t.description,
      note: t.note,
      categoryId: t.categoryId,
      accountId: t.accountId,
      cleared: t.cleared,
      isVirtual: false,
      // Credit-card payment credits are not real income — they reduce the CC
      // balance. The corresponding checking debit is the true cash outflow.
      isTransfer: acct?.type === "CREDIT_CARD" && t.type === "INCOME",
      recurringRuleId: t.recurringRuleId,
      plaidTransactionId: t.plaidTransactionId,
      createdBy: t.createdBy,
    };
  });

  // Track materialised dates per rule with a 4-day proximity window so that
  // a virtual occurrence on (e.g.) the 7th is suppressed when the real payment
  // landed on the 8th — common with bank processing delays.
  const materialisedByRule = new Map<string, number[]>();
  for (const t of txnRows) {
    if (t.recurringRuleId) {
      const arr = materialisedByRule.get(t.recurringRuleId) ?? [];
      arr.push(t.date.getTime());
      materialisedByRule.set(t.recurringRuleId, arr);
    }
  }
  const MATCH_WINDOW_MS = 4 * 86_400_000;
  function occurrenceIsMatched(ruleId: string, occ: Date): boolean {
    const dates = materialisedByRule.get(ruleId);
    if (!dates) return false;
    const ts = occ.getTime();
    return dates.some((d) => Math.abs(d - ts) <= MATCH_WINDOW_MS);
  }

  // Project recurring rules across the range.
  const rules = await prisma.recurringRule.findMany({
    where: { householdId, archived: false },
  });
  for (const rule of rules) {
    const occurrences = expandOccurrences(
      {
        frequency: rule.frequency,
        interval: rule.interval,
        startDate: rule.startDate,
        endDate: rule.endDate,
        dayOfMonth: rule.dayOfMonth,
        weekday: rule.weekday,
      },
      rangeStart,
      rangeEnd,
    );
    const ruleAcct = rule.accountId ? accountById.get(rule.accountId) : null;
    for (const occ of occurrences) {
      if (occurrenceIsMatched(rule.id, occ)) continue;
      const iso = isoDay(occ);
      events.push({
        id: `rule:${rule.id}:${iso}`,
        date: iso,
        type: rule.type,
        amount: toNumber(rule.amount),
        description: rule.description,
        note: rule.note,
        categoryId: rule.categoryId,
        accountId: rule.accountId,
        cleared: false,
        isVirtual: true,
        isTransfer: ruleAcct?.type === "CREDIT_CARD" && rule.type === "INCOME",
        recurringRuleId: rule.id,
        plaidTransactionId: null,
        createdBy: null,
      });
    }
  }

  // Cash-affecting events power the projection line.
  const cashTxns: ProjTxn[] = events
    .filter((e) => e.accountId && accountById.get(e.accountId)?.includeInCash)
    .map((e) => ({ date: e.date, amount: e.amount, type: e.type }));

  const projections: DayProjection[] = projectDailyBalances({
    days: grid,
    anchorDate: today,
    anchorBalance,
    txns: cashTxns,
  });

  const projection: DayProjectionDTO[] = projections.map((p) => ({
    iso: p.iso,
    income: p.income,
    expense: p.expense,
    net: p.net,
    balance: p.balance,
  }));
  const projectionByIso = Object.fromEntries(projection.map((p) => [p.iso, p]));

  // Group events for the visible grid days.
  const gridIso = new Set(grid.map(isoDay));
  const eventsByDay: Record<string, CalendarEvent[]> = {};
  let monthIncome = 0;
  let monthExpense = 0;
  const visibleMonth = monthDate.getUTCMonth();

  for (const e of events) {
    if (!gridIso.has(e.date)) continue;
    (eventsByDay[e.date] ??= []).push(e);
    if (toUTCDay(e.date).getUTCMonth() === visibleMonth) {
      // Credit-card payment credits (isTransfer) are not real income — skip them.
      if (e.type === "INCOME" && !e.isTransfer) monthIncome += e.amount;
      else if (e.type === "EXPENSE") monthExpense += e.amount;
    }
  }
  // Stable ordering within a day: income first, then by amount desc.
  for (const list of Object.values(eventsByDay)) {
    list.sort((a, b) => (a.type === b.type ? b.amount - a.amount : a.type === "INCOME" ? -1 : 1));
  }

  // Credit card payment due dates — show on the calendar for any account whose
  // nextPaymentDueDate falls within the visible grid.
  const ccDueByDay: Record<string, CcDueEvent[]> = {};
  for (const acct of accounts) {
    if (!acct.nextPaymentDueDate || !gridIso.has(acct.nextPaymentDueDate)) continue;
    // Suppress the due chip for dates that have already passed unless the
    // account is explicitly flagged overdue. If the due date is past and
    // isOverdue !== true, the payment was likely made and Plaid just hasn't
    // rolled nextPaymentDueDate forward yet.
    const dueTs = parseISODay(acct.nextPaymentDueDate).getTime();
    if (dueTs < today.getTime() && acct.isOverdue !== true) continue;
    (ccDueByDay[acct.nextPaymentDueDate] ??= []).push({
      accountId: acct.id,
      accountName: acct.name,
      color: acct.color,
      statementBalance: acct.lastStatementBalance,
      minimumPayment: acct.minimumPayment,
      dueDate: acct.nextPaymentDueDate,
      isOverdue: acct.isOverdue,
    });
  }

  return {
    monthISO: isoDay(monthDate),
    days: grid.map(isoDay),
    eventsByDay,
    ccDueByDay,
    projection,
    projectionByIso,
    anchorBalance,
    todayISO: isoDay(today),
    monthIncome,
    monthExpense,
  };
}
