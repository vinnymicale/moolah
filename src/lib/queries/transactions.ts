import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/money";
import { isoDay } from "@/lib/dates";
import { isEffectiveTransfer } from "@/lib/transfers";
import type { TxnType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import type { AttachmentDTO } from "@/lib/attachments";

export interface TransactionSplitDTO {
  categoryId: string | null;
  amount: number;
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
  /** The stored transfer flag (explicit pairing only). */
  isTransfer: boolean;
  /**
   * Whether this counts as a transfer for income/expense totals: the stored
   * flag OR the CC-payment-credit heuristic. Use this, not isTransfer, when
   * summing - see {@link isEffectiveTransfer}.
   */
  effectiveTransfer: boolean;
  recurringRuleId: string | null;
  plaidTransactionId: string | null;
  /** Per-category split parts. Empty when the transaction has a single category. */
  splits: TransactionSplitDTO[];
  tags: { id: string; name: string; color: string }[];
  /** Attachment metadata for the paperclip indicator and the modal list. */
  attachments: AttachmentDTO[];
}

/** Sentinel filter values for "no category" / "no account" rows. */
export const UNCATEGORIZED_ID = "__uncategorized__";
export const NO_ACCOUNT_ID = "__none__";

/**
 * Server-side filters for the transactions list. Empty arrays / strings mean
 * "no constraint". Category/account arrays may include the sentinels above.
 */
export interface TransactionFilters {
  search: string;
  types: TxnType[];
  statuses: ("CLEARED" | "PENDING")[];
  categoryIds: string[];
  accountIds: string[];
  tagIds: string[];
}

export const EMPTY_TRANSACTION_FILTERS: TransactionFilters = {
  search: "",
  types: [],
  statuses: [],
  categoryIds: [],
  accountIds: [],
  tagIds: [],
};

export const TRANSACTIONS_PAGE_SIZE = 100;

function transactionWhere(
  userId: string,
  startISO: string,
  endISO: string,
  filters: TransactionFilters,
): Prisma.TransactionWhereInput {
  const and: Prisma.TransactionWhereInput[] = [];
  if (filters.types.length > 0) and.push({ type: { in: filters.types } });
  // Both statuses selected is the same as no constraint.
  if (filters.statuses.length === 1) and.push({ cleared: filters.statuses[0] === "CLEARED" });
  if (filters.categoryIds.length > 0) {
    const ids = filters.categoryIds.filter((v) => v !== UNCATEGORIZED_ID);
    const or: Prisma.TransactionWhereInput[] = [];
    if (ids.length > 0) or.push({ categoryId: { in: ids } });
    if (filters.categoryIds.includes(UNCATEGORIZED_ID)) or.push({ categoryId: null });
    and.push({ OR: or });
  }
  if (filters.accountIds.length > 0) {
    const ids = filters.accountIds.filter((v) => v !== NO_ACCOUNT_ID);
    const or: Prisma.TransactionWhereInput[] = [];
    if (ids.length > 0) or.push({ accountId: { in: ids } });
    if (filters.accountIds.includes(NO_ACCOUNT_ID)) or.push({ accountId: null });
    and.push({ OR: or });
  }
  if (filters.tagIds.length > 0) {
    and.push({ tags: { some: { id: { in: filters.tagIds } } } });
  }
  if (filters.search) {
    const q = filters.search;
    and.push({
      OR: [
        { description: { contains: q, mode: "insensitive" } },
        { note: { contains: q, mode: "insensitive" } },
        { category: { is: { name: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }
  return {
    userId,
    deletedAt: null,
    date: { gte: new Date(`${startISO}T00:00:00.000Z`), lte: new Date(`${endISO}T00:00:00.000Z`) },
    ...(and.length > 0 ? { AND: and } : {}),
  };
}

const ATTACHMENT_SELECT = { select: { id: true, filename: true, mimeType: true, size: true } } as const;

type TransactionRow = Prisma.TransactionGetPayload<{
  include: {
    splits: true;
    account: { select: { type: true } };
    tags: { select: { id: true; name: true; color: true } };
    attachments: { select: { id: true; filename: true; mimeType: true; size: true } };
  };
}>;

function toTransactionDTO(t: TransactionRow): TransactionDTO {
  return {
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
    effectiveTransfer: isEffectiveTransfer({
      type: t.type,
      isTransfer: t.isTransfer,
      accountType: t.account?.type ?? null,
    }),
    recurringRuleId: t.recurringRuleId,
    plaidTransactionId: t.plaidTransactionId,
    splits: t.splits.map((s) => ({ categoryId: s.categoryId, amount: toNumber(s.amount) })),
    tags: t.tags.map((x) => ({ id: x.id, name: x.name, color: x.color })),
    attachments: t.attachments.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size })),
  };
}

export async function getTransactionsBetween(
  userId: string,
  startISO: string,
  endISO: string,
  filters: TransactionFilters = EMPTY_TRANSACTION_FILTERS,
): Promise<TransactionDTO[]> {
  const rows = await prisma.transaction.findMany({
    where: transactionWhere(userId, startISO, endISO, filters),
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: {
      splits: true,
      account: { select: { type: true } },
      tags: { select: { id: true, name: true, color: true } },
      attachments: ATTACHMENT_SELECT,
    },
  });
  return rows.map(toTransactionDTO);
}

export interface TransactionsPageDTO {
  items: TransactionDTO[];
  /** Rows matching the filters across all pages. */
  total: number;
  page: number;
  pageCount: number;
  /** Income/expense sums over ALL matching rows, transfers excluded. */
  income: number;
  expense: number;
}

/**
 * One page of filtered transactions plus whole-result-set totals, so the
 * client never holds more than a page of rows. Transfers are excluded from
 * the income/expense sums the same way isEffectiveTransfer does it: the
 * stored flag, plus INCOME rows on credit-card accounts.
 */
export async function getTransactionsPage(
  userId: string,
  startISO: string,
  endISO: string,
  filters: TransactionFilters = EMPTY_TRANSACTION_FILTERS,
  page = 1,
): Promise<TransactionsPageDTO> {
  const where = transactionWhere(userId, startISO, endISO, filters);
  const notCreditCardIncome: Prisma.TransactionWhereInput = {
    OR: [{ accountId: null }, { account: { type: { not: "CREDIT_CARD" } } }],
  };
  const [total, incomeAgg, expenseAgg] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.aggregate({
      _sum: { amount: true },
      where: { AND: [where, { type: "INCOME", isTransfer: false }, notCreditCardIncome] },
    }),
    prisma.transaction.aggregate({
      _sum: { amount: true },
      where: { AND: [where, { type: "EXPENSE", isTransfer: false }] },
    }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / TRANSACTIONS_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const rows = await prisma.transaction.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: {
      splits: true,
      account: { select: { type: true } },
      tags: { select: { id: true, name: true, color: true } },
      attachments: ATTACHMENT_SELECT,
    },
    skip: (safePage - 1) * TRANSACTIONS_PAGE_SIZE,
    take: TRANSACTIONS_PAGE_SIZE,
  });
  return {
    items: rows.map(toTransactionDTO),
    total,
    page: safePage,
    pageCount,
    income: toNumber(incomeAgg._sum.amount ?? 0),
    expense: toNumber(expenseAgg._sum.amount ?? 0),
  };
}

export interface DeletedTransactionDTO {
  id: string;
  type: TxnType;
  amount: number;
  date: string; // ISO day
  description: string;
  accountId: string | null;
  categoryId: string | null;
  /** When the row was deleted, as a full ISO timestamp. */
  deletedAt: string;
}

/**
 * Recently soft-deleted transactions, newest deletion first. Powers the trash
 * view where rows can be restored or purged. Capped so the list stays bounded.
 */
export async function getDeletedTransactions(userId: string, limit = 200): Promise<DeletedTransactionDTO[]> {
  const rows = await prisma.transaction.findMany({
    where: { userId, deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    take: limit,
    select: { id: true, type: true, amount: true, date: true, description: true, accountId: true, categoryId: true, deletedAt: true },
  });
  return rows.map((t) => ({
    id: t.id,
    type: t.type,
    amount: toNumber(t.amount),
    date: isoDay(t.date),
    description: t.description,
    accountId: t.accountId,
    categoryId: t.categoryId,
    deletedAt: t.deletedAt!.toISOString(),
  }));
}
