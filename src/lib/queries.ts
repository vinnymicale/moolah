// Read layer. Returns plain, serializable DTOs (numbers, strings, ISO dates) so
// results can be passed straight into client components - Prisma Decimal values
// are never sent across that boundary.

import { prisma } from "@/lib/prisma";
import { fromCents, toCents, toNumber } from "@/lib/money";
import { addUTCMonths, endOfUTCMonth, isoDay, parseISODay, startOfUTCMonth } from "@/lib/dates";
import { expandOccurrences } from "@/lib/recurrence";
import {
  detectRecurringCandidates,
  type RecurringSuggestion,
  type TxnForDetect,
} from "@/lib/recurring-suggestions";
import type { AccountType, CategoryKind, TxnType, Frequency } from "@/generated/prisma/enums";

export type { RecurringSuggestion } from "@/lib/recurring-suggestions";

export interface AccountDTO {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  currentBalance: number;
  isAsset: boolean;
  includeInCash: boolean;
  includeInNetWorth: boolean;
  includeInDebtPlanner: boolean;
  color: string;
  archived: boolean;
  interestRate: number | null;
  minimumPayment: number | null;
  creditLimit: number | null;
  lastStatementBalance: number | null;
  lastStatementDate: string | null; // ISO day
  lastPaymentAmount: number | null;
  lastPaymentDate: string | null;   // ISO day
  nextPaymentDueDate: string | null; // ISO day
  isOverdue: boolean | null;
}

export interface CategoryDTO {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
  parentId: string | null;
}

export interface TransactionDTO {
  id: string;
  type: TxnType;
  amount: number;
  date: string; // ISO day
  description: string;
  note: string | null;
  accountId: string | null;
  categoryId: string | null;
  cleared: boolean;
  /** Part of a transfer pair (e.g. CC payment) - excluded from income/expense totals. */
  isTransfer: boolean;
  recurringRuleId: string | null;
  plaidTransactionId: string | null;
  createdBy: { id: string; name: string | null; image: string | null } | null;
}

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

export async function getAccounts(householdId: string, includeArchived = false): Promise<AccountDTO[]> {
  const rows = await prisma.financialAccount.findMany({
    where: { householdId, ...(includeArchived ? {} : { archived: false }) },
    orderBy: [{ isAsset: "desc" }, { createdAt: "asc" }],
  });
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    institution: a.institution,
    currentBalance: toNumber(a.currentBalance),
    isAsset: a.isAsset,
    includeInCash: a.includeInCash,
    includeInNetWorth: a.includeInNetWorth,
    includeInDebtPlanner: a.includeInDebtPlanner,
    color: a.color,
    archived: a.archived,
    interestRate: a.interestRate !== null ? toNumber(a.interestRate) : null,
    minimumPayment: a.minimumPayment !== null ? toNumber(a.minimumPayment) : null,
    creditLimit: a.creditLimit !== null ? toNumber(a.creditLimit) : null,
    lastStatementBalance: a.lastStatementBalance !== null ? toNumber(a.lastStatementBalance) : null,
    lastStatementDate: a.lastStatementDate ? isoDay(a.lastStatementDate) : null,
    lastPaymentAmount: a.lastPaymentAmount !== null ? toNumber(a.lastPaymentAmount) : null,
    lastPaymentDate: a.lastPaymentDate ? isoDay(a.lastPaymentDate) : null,
    nextPaymentDueDate: a.nextPaymentDueDate ? isoDay(a.nextPaymentDueDate) : null,
    isOverdue: a.isOverdue ?? null,
  }));
}

export async function getCategories(householdId: string): Promise<CategoryDTO[]> {
  const rows = await prisma.category.findMany({
    where: { householdId },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    color: c.color,
    icon: c.icon,
    parentId: c.parentId,
  }));
}

export async function getRecurringRules(householdId: string, includeArchived = false): Promise<RecurringDTO[]> {
  const rows = await prisma.recurringRule.findMany({
    where: { householdId, ...(includeArchived ? {} : { archived: false }) },
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

export interface CategoryRuleDTO {
  id: string;
  pattern: string;
  categoryId: string;
}

export async function getCategoryRules(householdId: string): Promise<CategoryRuleDTO[]> {
  const rows = await prisma.categoryRule.findMany({
    where: { householdId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ id: r.id, pattern: r.pattern, categoryId: r.categoryId }));
}

export interface NetWorth {
  assets: number;
  liabilities: number;
  net: number;
  accounts: AccountDTO[];
}

export async function getNetWorth(householdId: string): Promise<NetWorth> {
  const accounts = await getAccounts(householdId);
  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    if (!a.includeInNetWorth) continue;
    if (a.isAsset) assets += a.currentBalance;
    else liabilities += a.currentBalance;
  }
  return { assets, liabilities, net: assets - liabilities, accounts };
}

export async function getTransactionsBetween(
  householdId: string,
  startISO: string,
  endISO: string,
): Promise<TransactionDTO[]> {
  const rows = await prisma.transaction.findMany({
    where: { householdId, date: { gte: new Date(`${startISO}T00:00:00.000Z`), lte: new Date(`${endISO}T00:00:00.000Z`) } },
    include: { createdBy: { select: { id: true, name: true, image: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((t) => ({
    id: t.id,
    type: t.type,
    amount: toNumber(t.amount),
    date: isoDay(t.date),
    description: t.description,
    note: t.note,
    accountId: t.accountId,
    categoryId: t.categoryId,
    cleared: t.cleared,
    isTransfer: t.isTransfer,
    recurringRuleId: t.recurringRuleId,
    plaidTransactionId: t.plaidTransactionId,
    createdBy: t.createdBy,
  }));
}

export interface BudgetLineDTO {
  categoryId: string;
  name: string;
  color: string;
  icon: string;
  /** Monthly limit, or 0 if no budget is set for this category. */
  limit: number;
  /** Actual expense spending in the month. */
  actual: number;
}

/**
 * Budget vs. actual for every expense category in a given month. `monthISO` is
 * any day in the target month ("YYYY-MM-01" by convention). Categories without
 * a budget come back with limit 0 so the UI can offer to set one.
 */
export async function getBudgetMonth(householdId: string, monthISO: string): Promise<BudgetLineDTO[]> {
  const monthStart = parseISODay(`${monthISO.slice(0, 7)}-01`);
  const monthEnd = endOfUTCMonth(monthStart);

  const [cats, budgets, txns] = await Promise.all([
    prisma.category.findMany({ where: { householdId, kind: "EXPENSE" }, orderBy: { name: "asc" } }),
    prisma.budget.findMany({ where: { householdId, month: monthStart } }),
    prisma.transaction.findMany({
      where: { householdId, type: "EXPENSE", isTransfer: false, date: { gte: monthStart, lte: monthEnd } },
      select: { categoryId: true, amount: true },
    }),
  ]);

  const limitByCat = new Map(budgets.map((b) => [b.categoryId, toNumber(b.limit)]));
  const actualCentsByCat = new Map<string, number>();
  for (const t of txns) {
    if (!t.categoryId) continue;
    actualCentsByCat.set(t.categoryId, (actualCentsByCat.get(t.categoryId) ?? 0) + toCents(t.amount));
  }

  return cats.map((c) => ({
    categoryId: c.id,
    name: c.name,
    color: c.color,
    icon: c.icon,
    limit: limitByCat.get(c.id) ?? 0,
    actual: fromCents(actualCentsByCat.get(c.id) ?? 0),
  }));
}

/**
 * Suggest recurring rules by scanning the last ~8 months of transactions for
 * regularly-repeating charges that aren't already covered by a rule.
 */
export async function getRecurringSuggestions(householdId: string, todayISO: string): Promise<RecurringSuggestion[]> {
  const since = startOfUTCMonth(addUTCMonths(parseISODay(todayISO), -8));

  const [txns, rules] = await Promise.all([
    prisma.transaction.findMany({
      where: { householdId, date: { gte: since } },
      select: { date: true, description: true, amount: true, type: true, categoryId: true, accountId: true, recurringRuleId: true },
      orderBy: { date: "asc" },
    }),
    prisma.recurringRule.findMany({ where: { householdId }, select: { description: true } }),
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

export interface BudgetMonthSummaryDTO {
  monthISO: string;
  label: string;
  budget: number;
  actual: number;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Budgeted vs. actual spending for each of the 12 months of `year`. */
export async function getBudgetYear(householdId: string, year: number): Promise<BudgetMonthSummaryDTO[]> {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));

  const [budgets, txns] = await Promise.all([
    prisma.budget.findMany({ where: { householdId, month: { gte: yearStart, lte: new Date(Date.UTC(year, 11, 1)) } } }),
    prisma.transaction.findMany({
      where: { householdId, type: "EXPENSE", isTransfer: false, date: { gte: yearStart, lte: yearEnd } },
      select: { date: true, amount: true },
    }),
  ]);

  const budgetByMonth = new Map<number, number>();
  for (const b of budgets) {
    const mi = b.month.getUTCMonth();
    budgetByMonth.set(mi, (budgetByMonth.get(mi) ?? 0) + toNumber(b.limit));
  }
  const actualCentsByMonth = new Map<number, number>();
  for (const t of txns) {
    const mi = t.date.getUTCMonth();
    actualCentsByMonth.set(mi, (actualCentsByMonth.get(mi) ?? 0) + toCents(t.amount));
  }

  return Array.from({ length: 12 }, (_, i) => ({
    monthISO: `${year}-${String(i + 1).padStart(2, "0")}-01`,
    label: MONTHS_SHORT[i],
    budget: budgetByMonth.get(i) ?? 0,
    actual: fromCents(actualCentsByMonth.get(i) ?? 0),
  }));
}

export interface PlaidLinkedAccountDTO {
  id: string;
  plaidAccountId: string;
  financialAccountId: string | null;
  name: string;
  officialName: string | null;
  mask: string | null;
  plaidType: string;
  plaidSubtype: string | null;
  availableBalance: number | null;
  currentBalance: number | null;
}

export interface PlaidItemDTO {
  id: string;
  institutionName: string | null;
  institutionId: string | null;
  lastSyncedAt: string | null;
  error: string | null;
  linkedAccounts: PlaidLinkedAccountDTO[];
}

export async function getPlaidItems(householdId: string): Promise<PlaidItemDTO[]> {
  const items = await prisma.plaidItem.findMany({
    where: { householdId },
    include: { linkedAccounts: true },
    orderBy: { createdAt: "asc" },
  });
  return items.map((item) => ({
    id: item.id,
    institutionName: item.institutionName,
    institutionId: item.institutionId,
    lastSyncedAt: item.lastSyncedAt ? item.lastSyncedAt.toISOString() : null,
    error: item.error,
    linkedAccounts: item.linkedAccounts.map((a) => ({
      id: a.id,
      plaidAccountId: a.plaidAccountId,
      financialAccountId: a.financialAccountId,
      name: a.name,
      officialName: a.officialName,
      mask: a.mask,
      plaidType: a.plaidType,
      plaidSubtype: a.plaidSubtype,
      availableBalance: toNumber(a.availableBalance),
      currentBalance: toNumber(a.currentBalance),
    })),
  }));
}

export interface SavingsGoalDTO {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string | null;
  color: string;
  icon: string;
  archived: boolean;
}

export async function getSavingsGoals(householdId: string, includeArchived = false): Promise<SavingsGoalDTO[]> {
  const rows = await prisma.savingsGoal.findMany({
    where: { householdId, ...(includeArchived ? {} : { archived: false }) },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((g) => ({
    id: g.id,
    name: g.name,
    targetAmount: toNumber(g.targetAmount),
    currentAmount: toNumber(g.currentAmount),
    targetDate: g.targetDate ? isoDay(g.targetDate) : null,
    color: g.color,
    icon: g.icon,
    archived: g.archived,
  }));
}

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
}

const BUFFER_CUSHION_PCT = 15;

/**
 * Computes how much the household can safely move out of checking.
 *
 * Formula: checkingBalance - remaining uncleared expenses this month
 *          - (earlyMonthAvg × 1.15 next-month buffer), rounded down to $50.
 *
 * Shown throughout the entire month (not gated on remaining days).
 * Returns show:false when no checking accounts exist or the safe amount < $50.
 */
export async function getSafeToTransfer(householdId: string, todayISO: string): Promise<SafeTransferDTO> {
  const nothing: SafeTransferDTO = {
    show: false, safeAmount: 0, anchorBalance: 0, checkingCount: 0,
    remainingExpenses: 0, remainingRecurring: 0, remainingRecurringCount: 0,
    remainingOneOff: 0, remainingOneOffCount: 0, nextMonthBuffer: 0, earlyMonthAvg: 0,
    bufferMonthsUsed: 0, bufferCushionPct: BUFFER_CUSHION_PCT, rawSafe: 0, daysLeft: 0, totalCCBalance: 0,
  };

  const today = parseISODay(todayISO);
  const monthStart = startOfUTCMonth(today);
  const monthEnd = endOfUTCMonth(today);
  const daysLeft = Math.round((monthEnd.getTime() - today.getTime()) / 86_400_000);

  // Fetch all accounts once and derive typed subsets.
  const allAccounts = await prisma.financialAccount.findMany({
    where: { householdId, archived: false },
    select: { id: true, type: true, currentBalance: true, isAsset: true },
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

  // ── Remaining planned expenses this month ─────────────────────────────────
  // Uncleared DB rows from bank accounts only (CC account transactions are
  // either individual charges - cash-flow neutral for checking - or statement
  // payments mis-tagged as income).
  const [unclearedTxns, recurringRules, materialisedLinks] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        householdId,
        type: "EXPENSE",
        cleared: false,
        date: { gte: today, lte: monthEnd },
        // Exclude transactions explicitly from CC accounts.
        ...(ccIds.length > 0 ? { NOT: { accountId: { in: ccIds } } } : {}),
      },
      select: { amount: true },
    }),
    prisma.recurringRule.findMany({ where: { householdId, type: "EXPENSE", archived: false } }),
    prisma.transaction.findMany({
      where: { householdId, recurringRuleId: { not: null }, date: { gte: today, lte: monthEnd } },
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
        householdId,
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

  const rawSafe = anchorBalance - remainingExpenses - nextMonthBuffer;
  const safeAmount = Math.floor(rawSafe / 50) * 50;

  if (safeAmount < 50) return nothing;

  return {
    show: true, safeAmount, anchorBalance, checkingCount: checkingIds.length,
    remainingExpenses, remainingRecurring, remainingRecurringCount,
    remainingOneOff, remainingOneOffCount, nextMonthBuffer, earlyMonthAvg,
    bufferMonthsUsed, bufferCushionPct: BUFFER_CUSHION_PCT, rawSafe, daysLeft, totalCCBalance,
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
  householdId: string,
  monthISO: string,
): Promise<SpendingAnomalyDTO[]> {
  const monthStart = parseISODay(`${monthISO.slice(0, 7)}-01`);
  const monthEnd = endOfUTCMonth(monthStart);

  const currentTxns = await prisma.transaction.findMany({
    where: {
      householdId,
      type: "EXPENSE",
      cleared: true,
      isTransfer: false,
      categoryId: { not: null },
      date: { gte: monthStart, lte: monthEnd },
    },
    select: { categoryId: true, amount: true },
  });

  const currentByCat = new Map<string, number>();
  for (const t of currentTxns) {
    if (!t.categoryId) continue;
    currentByCat.set(t.categoryId, (currentByCat.get(t.categoryId) ?? 0) + toNumber(t.amount));
  }
  if (currentByCat.size === 0) return [];

  // Three prior months, one query each (keeps this readable; only 3 trips).
  const historicalByCat = new Map<string, number[]>();
  for (let i = 1; i <= 3; i++) {
    const ms = addUTCMonths(monthStart, -i);
    const me = endOfUTCMonth(ms);
    const hist = await prisma.transaction.findMany({
      where: {
        householdId,
        type: "EXPENSE",
        cleared: true,
        isTransfer: false,
        categoryId: { in: [...currentByCat.keys()] },
        date: { gte: ms, lte: me },
      },
      select: { categoryId: true, amount: true },
    });
    const monthByCat = new Map<string, number>();
    for (const t of hist) {
      if (!t.categoryId) continue;
      monthByCat.set(t.categoryId, (monthByCat.get(t.categoryId) ?? 0) + toNumber(t.amount));
    }
    for (const catId of currentByCat.keys()) {
      const arr = historicalByCat.get(catId) ?? [];
      arr.push(monthByCat.get(catId) ?? 0);
      historicalByCat.set(catId, arr);
    }
  }

  const cats = await prisma.category.findMany({
    where: { id: { in: [...currentByCat.keys()] }, householdId },
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
  householdId: string,
  monthISO: string,
  limit = 6,
): Promise<TopMerchantDTO[]> {
  const monthStart = parseISODay(`${monthISO.slice(0, 7)}-01`);
  const monthEnd = endOfUTCMonth(monthStart);

  const txns = await prisma.transaction.findMany({
    where: {
      householdId,
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

// ── Snapshots ─────────────────────────────────────────────────────────────────

export interface SnapshotDTO {
  id: string;
  accountId: string;
  date: string;
  balance: number;
  note: string | null;
}

export async function getSnapshots(householdId: string): Promise<SnapshotDTO[]> {
  const rows = await prisma.accountSnapshot.findMany({
    where: { account: { householdId } },
    orderBy: { date: "asc" },
  });
  return rows.map((s) => ({
    id: s.id,
    accountId: s.accountId,
    date: isoDay(s.date),
    balance: toNumber(s.balance),
    note: s.note,
  }));
}
