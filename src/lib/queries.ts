// Read layer. Returns plain, serializable DTOs (numbers, strings, ISO dates) so
// results can be passed straight into client components — Prisma Decimal values
// are never sent across that boundary.

import { prisma } from "@/lib/prisma";
import { fromCents, toCents, toNumber } from "@/lib/money";
import { addUTCMonths, endOfUTCMonth, isoDay, parseISODay, startOfUTCMonth } from "@/lib/dates";
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
  color: string;
  archived: boolean;
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
  recurringRuleId: string | null;
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
    color: a.color,
    archived: a.archived,
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
    recurringRuleId: t.recurringRuleId,
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
      where: { householdId, type: "EXPENSE", date: { gte: monthStart, lte: monthEnd } },
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

  const existingDescriptions = rules.map((r) => r.description);
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
      where: { householdId, type: "EXPENSE", date: { gte: yearStart, lte: yearEnd } },
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
