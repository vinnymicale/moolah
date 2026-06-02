// Read layer. Returns plain, serializable DTOs (numbers, strings, ISO dates) so
// results can be passed straight into client components — Prisma Decimal values
// are never sent across that boundary.

import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/money";
import { isoDay } from "@/lib/dates";
import type { AccountType, CategoryKind, TxnType, Frequency } from "@/generated/prisma/enums";

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
