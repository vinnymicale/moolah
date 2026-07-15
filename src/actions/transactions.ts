"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getDeletedTransactions, type DeletedTransactionDTO } from "@/lib/queries";
import {
  scanDuplicateTransactions,
  removeDuplicateTransactions,
  ignoreDuplicateGroup,
  type DedupScan,
} from "@/lib/dedup-transactions";
import { requireUser } from "@/lib/session";
import { parseISODay } from "@/lib/dates";
import { run, UserError, type ActionResult } from "@/lib/action-result";
import { isDemoMode } from "@/lib/demo-guard";
import { validateSplits } from "@/lib/splits";
import { resolveTagIds } from "@/lib/tags";
import { TxnType, Frequency } from "@/generated/prisma/enums";

const recurringSchema = z.object({
  frequency: z.enum(Frequency),
  interval: z.coerce.number().int().min(1).max(366).default(1),
  dayOfMonth: z.coerce.number().int().min(1).max(31).optional().nullable(),
  weekday: z.coerce.number().int().min(0).max(6).optional().nullable(),
  endDate: z.string().optional().nullable(),
});

const splitSchema = z.object({
  categoryId: z.string().optional().nullable(),
  amount: z.coerce.number().positive("Split amount must be greater than zero"),
});

const txnSchema = z.object({
  type: z.enum(TxnType),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  date: z.string().min(1),
  description: z.string().min(1, "Description is required").max(120),
  note: z.string().max(500).optional().nullable(),
  accountId: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  cleared: z.boolean().optional().default(true),
  recurring: recurringSchema.optional().nullable(),
  // Optional category splits. When present (2+ parts summing to amount), the
  // transaction's own categoryId is cleared and these carry the attribution.
  splits: z.array(splitSchema).max(50).optional().nullable(),
  // Raw max 80 so normalizeTagName produces the user-facing 40-char error,
  // not a raw Zod one.
  tags: z.array(z.string().max(80)).max(20).optional().nullable(),
});

export type TransactionInput = z.input<typeof txnSchema>;

async function assertOwnership(
  userId: string,
  accountId?: string | null,
  categoryId?: string | null,
  type?: TxnType,
) {
  if (accountId) {
    const a = await prisma.financialAccount.findFirst({ where: { id: accountId, userId } });
    if (!a) throw new UserError("Account not found");
  }
  if (categoryId) {
    // When a type is given, require the category's kind to match (an expense
    // can't be filed under an income category), mirroring the form's options.
    const c = await prisma.category.findFirst({
      where: { id: categoryId, userId, ...(type ? { kind: type } : {}) },
    });
    if (!c) throw new UserError("Category not found");
  }
}

interface NormalizedSplit {
  categoryId: string | null;
  amount: number;
}

/**
 * Validate split parts against the transaction total and confirm every split
 * category belongs to the user and matches the transaction's kind (an EXPENSE
 * can only split across expense categories, etc. - mirroring what the form
 * offers). Returns the cleaned splits, or [] when no real split was provided
 * (a single part or none means "not split").
 */
export async function normalizeSplits(
  userId: string,
  type: TxnType,
  total: number,
  splits?: { categoryId?: string | null; amount: number }[] | null,
): Promise<NormalizedSplit[]> {
  if (!splits || splits.length < 2) return [];
  const cleaned: NormalizedSplit[] = splits.map((s) => ({ categoryId: s.categoryId || null, amount: s.amount }));
  const err = validateSplits(total, cleaned);
  if (err) throw new UserError(err);
  const catIds = [...new Set(cleaned.map((s) => s.categoryId).filter((id): id is string => !!id))];
  if (catIds.length > 0) {
    const found = await prisma.category.count({ where: { id: { in: catIds }, userId, kind: type } });
    if (found !== catIds.length) throw new UserError("Split category not found");
  }
  return cleaned;
}

export async function createTransactionAction(input: TransactionInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const data = txnSchema.parse(input);
    await assertOwnership(userId, data.accountId, data.categoryId, data.type);
    const splits = await normalizeSplits(userId, data.type, data.amount, data.splits);
    const tagIds = data.tags?.length ? await resolveTagIds(userId, data.tags) : [];

    await prisma.$transaction(async (tx) => {
      let recurringRuleId: string | undefined;
      if (data.recurring) {
        const rule = await tx.recurringRule.create({
          data: {
            userId,
            accountId: data.accountId || null,
            categoryId: data.categoryId || null,
            type: data.type,
            amount: data.amount,
            description: data.description,
            note: data.note || null,
            frequency: data.recurring.frequency,
            interval: data.recurring.interval ?? 1,
            dayOfMonth: data.recurring.dayOfMonth ?? null,
            weekday: data.recurring.weekday ?? null,
            startDate: parseISODay(data.date),
            endDate: data.recurring.endDate ? parseISODay(data.recurring.endDate) : null,
          },
        });
        recurringRuleId = rule.id;
      }

      await tx.transaction.create({
        data: {
          userId,
          accountId: data.accountId || null,
          // When split, the parent carries no single category.
          categoryId: splits.length > 0 ? null : data.categoryId || null,
          type: data.type,
          amount: data.amount,
          date: parseISODay(data.date),
          description: data.description,
          note: data.note || null,
          cleared: data.cleared ?? true,
          recurringRuleId,
          ...(splits.length > 0
            ? { splits: { create: splits.map((s) => ({ categoryId: s.categoryId, amount: s.amount })) } }
            : {}),
          ...(tagIds.length > 0 ? { tags: { connect: tagIds.map((id) => ({ id })) } } : {}),
        },
      });
    });
    revalidateAll();
  });
}

export async function updateTransactionAction(id: string, input: TransactionInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const existing = await prisma.transaction.findFirst({ where: { id, userId } });
    if (!existing) throw new UserError("Transaction not found");
    const data = txnSchema.parse(input);
    await assertOwnership(userId, data.accountId, data.categoryId, data.type);
    const splits = await normalizeSplits(userId, data.type, data.amount, data.splits);
    const tagIds = data.tags != null ? await resolveTagIds(userId, data.tags) : null;

    await prisma.$transaction(async (tx) => {
      // Replace any existing splits wholesale; the new set is authoritative.
      await tx.transactionSplit.deleteMany({ where: { transactionId: id } });
      await tx.transaction.update({
        where: { id },
        data: {
          accountId: data.accountId || null,
          categoryId: splits.length > 0 ? null : data.categoryId || null,
          type: data.type,
          amount: data.amount,
          date: parseISODay(data.date),
          description: data.description,
          note: data.note || null,
          cleared: data.cleared ?? existing.cleared,
          ...(splits.length > 0
            ? { splits: { create: splits.map((s) => ({ categoryId: s.categoryId, amount: s.amount })) } }
            : {}),
          ...(tagIds !== null ? { tags: { set: tagIds.map((id) => ({ id })) } } : {}),
        },
      });
    });
    revalidateAll();
  });
}

export async function deleteTransactionAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const existing = await prisma.transaction.findFirst({ where: { id, userId, deletedAt: null } });
    if (!existing) throw new UserError("Transaction not found");
    // Soft delete: keep the row so it can be restored from the trash and so a
    // re-imported Plaid charge matches on plaidTransactionId instead of
    // duplicating.
    await prisma.transaction.update({ where: { id }, data: { deletedAt: new Date() } });
    revalidateAll();
  });
}

export async function restoreTransactionAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const existing = await prisma.transaction.findFirst({ where: { id, userId, deletedAt: { not: null } } });
    if (!existing) throw new UserError("Transaction not found");
    await prisma.transaction.update({ where: { id }, data: { deletedAt: null } });
    revalidateAll();
  });
}

export async function permanentDeleteTransactionAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const existing = await prisma.transaction.findFirst({ where: { id, userId, deletedAt: { not: null } } });
    if (!existing) throw new UserError("Transaction not found");
    await prisma.transaction.delete({ where: { id } });
    revalidateAll();
  });
}

// Load the recently-deleted transactions for the trash view. Demo mode has no
// trash (deletes are no-ops there), so it always comes back empty.
export async function listDeletedTransactionsAction(): Promise<DeletedTransactionDTO[]> {
  if (isDemoMode()) return [];
  const { userId } = await requireUser();
  return getDeletedTransactions(userId);
}

// Scan for duplicate Plaid transactions (same account/date/amount/type/
// description, kept as more than one non-deleted row) and report what could be
// removed. This is the self-serve path for a self-hosted box where there's no
// shell access to the DB. Demo mode has nothing to dedup.
export async function scanDuplicateTransactionsAction(): Promise<DedupScan> {
  if (isDemoMode()) return { groups: [], removableCount: 0 };
  const { userId } = await requireUser();
  return scanDuplicateTransactions(userId);
}

// Remove the duplicate copies of the selected groups, keeping the oldest in
// each. `keepIds` names the groups (by their kept row) the user checked. Soft
// sends the copies to the trash (recoverable); hard deletes them outright.
export async function removeDuplicateTransactionsAction(
  mode: "soft" | "hard",
  keepIds: string[],
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    await removeDuplicateTransactions(userId, mode, keepIds);
    revalidateAll();
  });
}

// Accept a duplicate group as legitimate (two identical charges that both
// really happened) so it stops showing up in the scan.
export async function ignoreDuplicateGroupAction(ids: string[]): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    await ignoreDuplicateGroup(userId, ids);
    revalidateAll();
  });
}

export async function setClearedAction(id: string, cleared: boolean): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const existing = await prisma.transaction.findFirst({ where: { id, userId } });
    if (!existing) throw new UserError("Transaction not found");
    await prisma.transaction.update({ where: { id }, data: { cleared } });
    revalidateAll();
  });
}

// ---------------------------------------------------------------------------
// Bulk operations (driven by multi-select on the Transactions list). Each is
// scoped to the user, so a stray id can never touch another user's
// data.
// ---------------------------------------------------------------------------

const idsSchema = z.array(z.string().min(1)).min(1, "Select at least one transaction").max(1000);

export async function bulkSetCategoryAction(ids: string[], categoryId: string | null): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const list = idsSchema.parse(ids);
    if (categoryId) {
      const c = await prisma.category.findFirst({ where: { id: categoryId, userId } });
      if (!c) throw new UserError("Category not found");
    }
    // Setting a single category supersedes any splits on the selected rows.
    await prisma.$transaction([
      prisma.transactionSplit.deleteMany({ where: { transaction: { userId, id: { in: list } } } }),
      prisma.transaction.updateMany({ where: { userId, id: { in: list } }, data: { categoryId } }),
    ]);
    revalidateAll();
  });
}

export async function bulkAddTagAction(ids: string[], tagId: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const list = idsSchema.parse(ids);
    const tag = await prisma.tag.findFirst({ where: { id: tagId, userId } });
    if (!tag) throw new UserError("Tag not found");
    // updateMany cannot touch m2m relations, and connect on an existing pair
    // violates the join table's unique constraint - per-row updates, new rows only.
    const rows = await prisma.transaction.findMany({
      where: { userId, id: { in: list }, NOT: { tags: { some: { id: tagId } } } },
      select: { id: true },
    });
    await prisma.$transaction(
      rows.map((t) =>
        prisma.transaction.update({ where: { id: t.id }, data: { tags: { connect: { id: tagId } } } }),
      ),
    );
    revalidateAll();
  });
}

export async function bulkRemoveTagAction(ids: string[], tagId: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const list = idsSchema.parse(ids);
    const tag = await prisma.tag.findFirst({ where: { id: tagId, userId } });
    if (!tag) throw new UserError("Tag not found");
    const rows = await prisma.transaction.findMany({
      where: { userId, id: { in: list }, tags: { some: { id: tagId } } },
      select: { id: true },
    });
    await prisma.$transaction(
      rows.map((t) =>
        prisma.transaction.update({ where: { id: t.id }, data: { tags: { disconnect: { id: tagId } } } }),
      ),
    );
    revalidateAll();
  });
}

export async function bulkSetAccountAction(ids: string[], accountId: string | null): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const list = idsSchema.parse(ids);
    if (accountId) {
      const a = await prisma.financialAccount.findFirst({ where: { id: accountId, userId } });
      if (!a) throw new UserError("Account not found");
    }
    await prisma.transaction.updateMany({ where: { userId, id: { in: list } }, data: { accountId } });
    revalidateAll();
  });
}

export async function bulkSetClearedAction(ids: string[], cleared: boolean): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const list = idsSchema.parse(ids);
    await prisma.transaction.updateMany({ where: { userId, id: { in: list } }, data: { cleared } });
    revalidateAll();
  });
}

export async function bulkDeleteTransactionsAction(ids: string[]): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const list = idsSchema.parse(ids);
    await prisma.transaction.updateMany({
      where: { userId, id: { in: list }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    revalidateAll();
  });
}

const convertSchema = recurringSchema;
export type ConvertToRecurringInput = z.input<typeof convertSchema>;

/**
 * Promote an existing one-off transaction into a recurring series. Builds the
 * rule from the transaction's own fields (anchored at its date) and links the
 * source transaction to it so the start-date occurrence isn't double-counted.
 */
export async function convertToRecurringAction(id: string, input: ConvertToRecurringInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const txn = await prisma.transaction.findFirst({ where: { id, userId } });
    if (!txn) throw new UserError("Transaction not found");
    if (txn.recurringRuleId) throw new UserError("This transaction is already part of a recurring series.");
    const data = convertSchema.parse(input);

    await prisma.$transaction(async (tx) => {
      const rule = await tx.recurringRule.create({
        data: {
          userId,
          accountId: txn.accountId,
          categoryId: txn.categoryId,
          type: txn.type,
          amount: txn.amount,
          description: txn.description,
          note: txn.note,
          frequency: data.frequency,
          interval: data.interval ?? 1,
          dayOfMonth: data.dayOfMonth ?? null,
          weekday: data.weekday ?? null,
          startDate: txn.date,
          endDate: data.endDate ? parseISODay(data.endDate) : null,
        },
      });
      await tx.transaction.update({ where: { id }, data: { recurringRuleId: rule.id } });
    });

    revalidatePath("/recurring");
    revalidateAll();
  });
}

/**
 * Turn a projected recurring occurrence into a concrete transaction (e.g. when
 * a bill is actually paid). Idempotent per (rule, date).
 */
export async function materializeOccurrenceAction(ruleId: string, dateISO: string, cleared = true): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const rule = await prisma.recurringRule.findFirst({ where: { id: ruleId, userId } });
    if (!rule) throw new UserError("Recurring rule not found");
    const date = parseISODay(dateISO);

    const existing = await prisma.transaction.findFirst({
      where: { userId, recurringRuleId: ruleId, date },
    });
    if (existing) {
      await prisma.transaction.update({ where: { id: existing.id }, data: { cleared } });
    } else {
      await prisma.transaction.create({
        data: {
          userId,
          accountId: rule.accountId,
          categoryId: rule.categoryId,
          type: rule.type,
          amount: rule.amount,
          date,
          description: rule.description,
          note: rule.note,
          cleared,
          recurringRuleId: rule.id,
        },
      });
    }
    revalidateAll();
  });
}

// ---------------------------------------------------------------------------
// Transfer pairing - links the two sides of a money movement (e.g. the CC
// payment leaving checking and the credit landing on the card) so neither
// counts as income or spending.
// ---------------------------------------------------------------------------

export async function pairTransfersAction(idA: string, idB: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const txns = await prisma.transaction.findMany({ where: { id: { in: [idA, idB] }, userId } });
    if (txns.length !== 2) throw new UserError("Transaction not found");
    const [a, b] = txns;
    if (a.type === b.type) throw new UserError("A transfer pair needs one expense and one income.");
    if (a.isTransfer || b.isTransfer) throw new UserError("One of these is already part of a transfer pair.");
    const expense = a.type === "EXPENSE" ? a : b;
    const income = a.type === "EXPENSE" ? b : a;
    await prisma.$transaction([
      prisma.transaction.update({ where: { id: expense.id }, data: { isTransfer: true, transferPeerId: income.id } }),
      prisma.transaction.update({ where: { id: income.id }, data: { isTransfer: true } }),
    ]);
    revalidateAll();
  });
}

export async function unpairTransferAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const txn = await prisma.transaction.findFirst({
      where: { id, userId },
      include: { transferPeer: true, transferPeerOf: true },
    });
    if (!txn) throw new UserError("Transaction not found");
    if (!txn.isTransfer) throw new UserError("This transaction is not part of a transfer pair.");
    const peer = txn.transferPeer ?? txn.transferPeerOf;
    await prisma.$transaction([
      prisma.transaction.update({ where: { id: txn.id }, data: { isTransfer: false, transferPeerId: null } }),
      ...(peer
        ? [prisma.transaction.update({ where: { id: peer.id }, data: { isTransfer: false, transferPeerId: null } })]
        : []),
    ]);
    revalidateAll();
  });
}

// ---------------------------------------------------------------------------
// Global search - queries the entire transaction history (all accounts, all
// time) by description/note text, with an optional amount match. Drives the
// ⌘K command palette.
// ---------------------------------------------------------------------------

export interface SearchHit {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: TxnType;
  categoryId: string | null;
  accountId: string | null;
  note: string | null;
}

export async function searchTransactionsAction(query: string): Promise<SearchHit[]> {
  if (isDemoMode()) return [];
  const { userId } = await requireUser();
  const q = query.trim();
  if (q.length < 2) return [];

  // If the query looks like a number, also match transactions at that amount
  // (within a cent) so "42.50" finds the $42.50 charge.
  const numeric = Number(q.replace(/[$,]/g, ""));
  const amountClause =
    Number.isFinite(numeric) && numeric > 0
      ? [{ amount: { gte: numeric - 0.005, lte: numeric + 0.005 } }]
      : [];

  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      deletedAt: null,
      OR: [
        { description: { contains: q, mode: "insensitive" } },
        { note: { contains: q, mode: "insensitive" } },
        ...amountClause,
      ],
    },
    orderBy: { date: "desc" },
    take: 50,
    select: {
      id: true, date: true, description: true, amount: true,
      type: true, categoryId: true, accountId: true, note: true,
    },
  });

  return rows.map((t) => ({
    id: t.id,
    date: t.date.toISOString().slice(0, 10),
    description: t.description,
    amount: Number(t.amount),
    type: t.type,
    categoryId: t.categoryId,
    accountId: t.accountId,
    note: t.note,
  }));
}

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/transactions");
  revalidatePath("/trends");
}
