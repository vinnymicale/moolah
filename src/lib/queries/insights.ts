import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/money";
import { addUTCMonths, endOfUTCMonth, isoDay, parseISODay, startOfUTCMonth } from "@/lib/dates";
import { expandOccurrences } from "@/lib/recurrence";
import { sumPartsByCategory } from "@/lib/splits";
import { rowToSplittable } from "./shared";

export interface SafeTransferDTO {
  show: boolean;
  /** Recommended amount to transfer, rounded down to nearest $50. */
  safeAmount: number;
  /** Sum of all CHECKING account balances. */
  anchorBalance: number;
  /** Number of CHECKING accounts contributing to the anchor balance. */
  checkingCount: number;
  /** Planned expenses left this month: uncleared bank-account rows + unprojected recurring rules. */
  remainingExpenses: number;
  /** Portion of remainingExpenses from upcoming recurring rule occurrences. */
  remainingRecurring: number;
  /** Number of upcoming recurring bill occurrences counted this month. */
  remainingRecurringCount: number;
  /** Portion of remainingExpenses from one-off uncleared bank transactions. */
  remainingOneOff: number;
  /** Number of one-off uncleared bank transactions counted this month. */
  remainingOneOffCount: number;
  /** Historical avg spending in days 1-14 of a month (bank accounts only) × 1.15 safety buffer. */
  nextMonthBuffer: number;
  /** Raw average of early-month bank-account spending across the last 4 months. */
  earlyMonthAvg: number;
  /** Number of past months (of the last 4) that had data feeding earlyMonthAvg. */
  bufferMonthsUsed: number;
  /** Safety cushion percentage applied on top of earlyMonthAvg (e.g. 15). */
  bufferCushionPct: number;
  /** Raw safe figure before rounding down to the nearest $50. */
  rawSafe: number;
  /** Calendar days remaining in the current month. */
  daysLeft: number;
  /** Total outstanding balance across all credit card accounts (informational). */
  totalCCBalance: number;
  /** Sum of upcoming credit-card statement payments whose due date shows on the calendar. */
  upcomingCCDue: number;
  /** Number of credit cards with an upcoming statement payment counted in upcomingCCDue. */
  upcomingCCDueCount: number;
}

const BUFFER_CUSHION_PCT = 15;

/**
 * Computes how much the user can safely move out of checking.
 *
 * Formula: checkingBalance - remaining uncleared expenses this month
 *          - upcoming credit-card statement payments shown on the calendar
 *          - (earlyMonthAvg × 1.15 next-month buffer), rounded down to $50.
 *
 * The upcoming statement payments are subtracted in full on top of the buffer.
 * That deliberately over-reserves (the buffer already reflects past statement
 * payments), favouring the lowest chance of leaving checking short.
 *
 * Shown throughout the entire month (not gated on remaining days).
 * Returns show:false when no checking accounts exist or the safe amount < $50.
 */
export async function getSafeToTransfer(userId: string, todayISO: string): Promise<SafeTransferDTO> {
  const nothing: SafeTransferDTO = {
    show: false, safeAmount: 0, anchorBalance: 0, checkingCount: 0,
    remainingExpenses: 0, remainingRecurring: 0, remainingRecurringCount: 0,
    remainingOneOff: 0, remainingOneOffCount: 0, nextMonthBuffer: 0, earlyMonthAvg: 0,
    bufferMonthsUsed: 0, bufferCushionPct: BUFFER_CUSHION_PCT, rawSafe: 0, daysLeft: 0, totalCCBalance: 0,
    upcomingCCDue: 0, upcomingCCDueCount: 0,
  };

  const today = parseISODay(todayISO);
  const monthStart = startOfUTCMonth(today);
  const monthEnd = endOfUTCMonth(today);
  const daysLeft = Math.round((monthEnd.getTime() - today.getTime()) / 86_400_000);

  // Fetch all accounts once and derive typed subsets.
  const allAccounts = await prisma.financialAccount.findMany({
    where: { userId, archived: false },
    select: {
      id: true, type: true, currentBalance: true, isAsset: true,
      lastStatementBalance: true, nextPaymentDueDate: true, isOverdue: true,
    },
  });

  const checkingAccounts = allAccounts.filter((a) => a.type === "CHECKING");
  const checkingIds = checkingAccounts.map((a) => a.id);
  // Bank accounts: liquid assets whose transactions reflect real cash flow.
  const bankIds = allAccounts
    .filter((a) => a.type === "CHECKING" || a.type === "SAVINGS" || a.type === "CASH")
    .map((a) => a.id);
  // Credit card IDs - used to exclude their transactions from cash-flow maths.
  const ccIds = allAccounts.filter((a) => a.type === "CREDIT_CARD").map((a) => a.id);

  if (checkingIds.length === 0) return nothing;

  const anchorBalance = checkingAccounts.reduce((s, a) => s + toNumber(a.currentBalance), 0);

  // Outstanding credit card balances (informational - represents what will
  // become next cycle's statement payment, not double-counted in the formula).
  const totalCCBalance = allAccounts
    .filter((a) => ccIds.includes(a.id))
    .reduce((s, a) => s + toNumber(a.currentBalance), 0);

  // Upcoming credit-card statement payments the user can see on the calendar.
  // Same visibility rule as the calendar's due chips: a due date that's today
  // or later, or a past date explicitly flagged overdue (a past date that isn't
  // overdue usually means it was paid and Plaid hasn't rolled the date forward).
  // The statement balance is the amount that will leave checking.
  let upcomingCCDue = 0;
  let upcomingCCDueCount = 0;
  for (const a of allAccounts) {
    if (!ccIds.includes(a.id) || !a.nextPaymentDueDate) continue;
    const dueISO = isoDay(a.nextPaymentDueDate);
    const isPast = parseISODay(dueISO).getTime() < today.getTime();
    if (isPast && a.isOverdue !== true) continue;
    const statement = toNumber(a.lastStatementBalance ?? 0);
    if (statement <= 0) continue;
    upcomingCCDue += statement;
    upcomingCCDueCount++;
  }

  // ── Remaining planned expenses this month ─────────────────────────────────
  // Uncleared DB rows from bank accounts only (CC account transactions are
  // either individual charges - cash-flow neutral for checking - or statement
  // payments mis-tagged as income).
  const [unclearedTxns, recurringRules, materialisedLinks] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        type: "EXPENSE",
        cleared: false,
        date: { gte: today, lte: monthEnd },
        // Exclude transactions explicitly from CC accounts.
        ...(ccIds.length > 0 ? { NOT: { accountId: { in: ccIds } } } : {}),
      },
      select: { amount: true },
    }),
    prisma.recurringRule.findMany({ where: { userId, type: "EXPENSE", archived: false } }),
    prisma.transaction.findMany({
      where: { userId, deletedAt: null, recurringRuleId: { not: null }, date: { gte: today, lte: monthEnd } },
      select: { recurringRuleId: true, date: true },
    }),
  ]);

  // Skip rule occurrences already covered by a DB transaction (cleared or not).
  const materialised = new Set(materialisedLinks.map((t) => `${t.recurringRuleId}|${isoDay(t.date)}`));

  const remainingOneOff = unclearedTxns.reduce((s, t) => s + toNumber(t.amount), 0);
  const remainingOneOffCount = unclearedTxns.length;

  let remainingRecurring = 0;
  let remainingRecurringCount = 0;
  for (const rule of recurringRules) {
    const occs = expandOccurrences(
      { frequency: rule.frequency, interval: rule.interval, startDate: rule.startDate, endDate: rule.endDate, dayOfMonth: rule.dayOfMonth, weekday: rule.weekday },
      today,
      monthEnd,
    );
    for (const occ of occs) {
      if (!materialised.has(`${rule.id}|${isoDay(occ)}`)) {
        remainingRecurring += toNumber(rule.amount);
        remainingRecurringCount++;
      }
    }
  }

  const remainingExpenses = remainingOneOff + remainingRecurring;

  // ── Historical early-month buffer (bank accounts only) ────────────────────
  // Scoped to CHECKING/SAVINGS/CASH so we capture real cash outflows (rent,
  // CC statement payments from checking, utilities) without pulling in
  // individual CC charges or the mis-tagged "income" on CC accounts.
  const historicalTotals: number[] = [];
  for (let i = 1; i <= 4; i++) {
    const pastStart = addUTCMonths(monthStart, -i);
    const pastMid = new Date(Date.UTC(pastStart.getUTCFullYear(), pastStart.getUTCMonth(), 14));
    const agg = await prisma.transaction.aggregate({
      where: {
        userId,
        deletedAt: null,
        type: "EXPENSE",
        cleared: true,
        date: { gte: pastStart, lte: pastMid },
        ...(bankIds.length > 0 ? { accountId: { in: bankIds } } : {}),
      },
      _sum: { amount: true },
    });
    const total = toNumber(agg._sum.amount ?? 0);
    if (total > 0) historicalTotals.push(total);
  }

  const bufferMonthsUsed = historicalTotals.length;
  const earlyMonthAvg = bufferMonthsUsed > 0
    ? historicalTotals.reduce((s, t) => s + t, 0) / bufferMonthsUsed
    : 0;

  const nextMonthBuffer = earlyMonthAvg * (1 + BUFFER_CUSHION_PCT / 100);

  const rawSafe = anchorBalance - remainingExpenses - upcomingCCDue - nextMonthBuffer;
  const safeAmount = Math.floor(rawSafe / 50) * 50;

  if (safeAmount < 50) return nothing;

  return {
    show: true, safeAmount, anchorBalance, checkingCount: checkingIds.length,
    remainingExpenses, remainingRecurring, remainingRecurringCount,
    remainingOneOff, remainingOneOffCount, nextMonthBuffer, earlyMonthAvg,
    bufferMonthsUsed, bufferCushionPct: BUFFER_CUSHION_PCT, rawSafe, daysLeft, totalCCBalance,
    upcomingCCDue, upcomingCCDueCount,
  };
}

// ── Spending anomalies ────────────────────────────────────────────────────────

export interface SpendingAnomalyDTO {
  categoryId: string;
  name: string;
  color: string;
  icon: string;
  /** Cleared expense spend for the current month. */
  thisMonth: number;
  /** Average cleared expense spend for the prior 3 months. */
  avg3Month: number;
  overBy: number;
  overPct: number;
}

/**
 * Returns categories where this month's cleared spending is ≥40% above the
 * 3-month average AND at least $30 more in absolute terms.  Returns [] when
 * there are fewer than 2 prior months of data for a category.
 */
export async function getSpendingAnomalies(
  userId: string,
  monthISO: string,
): Promise<SpendingAnomalyDTO[]> {
  const monthStart = parseISODay(`${monthISO.slice(0, 7)}-01`);
  const monthEnd = endOfUTCMonth(monthStart);

  // We can't pre-filter by categoryId in SQL: split transactions carry their
  // category attribution on child rows (the parent's categoryId is null), so the
  // per-category bucketing has to happen in JS after expanding each row's parts.
  const currentTxns = await prisma.transaction.findMany({
    where: {
      userId,
      deletedAt: null,
      type: "EXPENSE",
      cleared: true,
      isTransfer: false,
      date: { gte: monthStart, lte: monthEnd },
    },
    select: { categoryId: true, amount: true, splits: { select: { categoryId: true, amount: true } } },
  });

  const currentByCat = sumPartsByCategory(currentTxns.map(rowToSplittable));
  if (currentByCat.size === 0) return [];

  // Three prior months, one query each (keeps this readable; only 3 trips).
  const historicalByCat = new Map<string, number[]>();
  for (let i = 1; i <= 3; i++) {
    const ms = addUTCMonths(monthStart, -i);
    const me = endOfUTCMonth(ms);
    const hist = await prisma.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        type: "EXPENSE",
        cleared: true,
        isTransfer: false,
        date: { gte: ms, lte: me },
      },
      select: { categoryId: true, amount: true, splits: { select: { categoryId: true, amount: true } } },
    });
    const monthByCat = sumPartsByCategory(hist.map(rowToSplittable));
    for (const catId of currentByCat.keys()) {
      const arr = historicalByCat.get(catId) ?? [];
      arr.push(monthByCat.get(catId) ?? 0);
      historicalByCat.set(catId, arr);
    }
  }

  const cats = await prisma.category.findMany({
    where: { id: { in: [...currentByCat.keys()] }, userId },
    select: { id: true, name: true, color: true, icon: true },
  });
  const catMap = new Map(cats.map((c) => [c.id, c]));

  const anomalies: SpendingAnomalyDTO[] = [];
  for (const [catId, thisMonth] of currentByCat) {
    const history = historicalByCat.get(catId) ?? [];
    const nonZeroCount = history.filter((h) => h > 0).length;
    if (nonZeroCount < 2) continue; // need at least 2 real data points
    const avg3Month = history.reduce((s, h) => s + h, 0) / 3;
    if (avg3Month === 0) continue;
    const overBy = thisMonth - avg3Month;
    const overPct = (overBy / avg3Month) * 100;
    if (overPct < 40 || overBy < 30) continue;
    const cat = catMap.get(catId);
    if (!cat) continue;
    anomalies.push({
      categoryId: catId,
      name: cat.name,
      color: cat.color,
      icon: cat.icon,
      thisMonth: Math.round(thisMonth * 100) / 100,
      avg3Month: Math.round(avg3Month * 100) / 100,
      overBy: Math.round(overBy * 100) / 100,
      overPct: Math.round(overPct),
    });
  }

  return anomalies.sort((a, b) => b.overBy - a.overBy);
}

// ── Top merchants ─────────────────────────────────────────────────────────────

export interface TopMerchantDTO {
  description: string;
  amount: number;
  count: number;
  categoryId: string | null;
}

/**
 * Returns the top `limit` payees by total cleared expense spending this month.
 * Descriptions are matched case-insensitively; the first-seen capitalisation
 * is used for display.
 */
export async function getTopMerchants(
  userId: string,
  monthISO: string,
  limit = 6,
): Promise<TopMerchantDTO[]> {
  const monthStart = parseISODay(`${monthISO.slice(0, 7)}-01`);
  const monthEnd = endOfUTCMonth(monthStart);

  const txns = await prisma.transaction.findMany({
    where: {
      userId,
      deletedAt: null,
      type: "EXPENSE",
      cleared: true,
      isTransfer: false,
      date: { gte: monthStart, lte: monthEnd },
    },
    select: { description: true, amount: true, categoryId: true },
  });

  const map = new Map<string, { display: string; amount: number; count: number; categoryId: string | null }>();
  for (const t of txns) {
    const key = t.description.trim().toLowerCase();
    const entry = map.get(key);
    if (entry) {
      entry.amount += toNumber(t.amount);
      entry.count++;
    } else {
      map.set(key, { display: t.description.trim(), amount: toNumber(t.amount), count: 1, categoryId: t.categoryId });
    }
  }

  return Array.from(map.values())
    .map((m) => ({ description: m.display, amount: Math.round(m.amount * 100) / 100, count: m.count, categoryId: m.categoryId }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}
