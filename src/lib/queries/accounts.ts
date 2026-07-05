import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/money";
import { isoDay } from "@/lib/dates";
import type { AccountType } from "@/generated/prisma/enums";

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

export async function getAccounts(userId: string, includeArchived = false): Promise<AccountDTO[]> {
  const rows = await prisma.financialAccount.findMany({
    where: { userId, ...(includeArchived ? {} : { archived: false }) },
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

export interface NetWorth {
  assets: number;
  liabilities: number;
  net: number;
  accounts: AccountDTO[];
}

export async function getNetWorth(userId: string): Promise<NetWorth> {
  const accounts = await getAccounts(userId);
  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    if (!a.includeInNetWorth) continue;
    if (a.isAsset) assets += a.currentBalance;
    else liabilities += a.currentBalance;
  }
  return { assets, liabilities, net: assets - liabilities, accounts };
}

export interface SnapshotDTO {
  id: string;
  accountId: string;
  date: string;
  balance: number;
  note: string | null;
}

export async function getSnapshots(userId: string): Promise<SnapshotDTO[]> {
  const rows = await prisma.accountSnapshot.findMany({
    where: { account: { userId } },
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
