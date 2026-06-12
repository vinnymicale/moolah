"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { parseISODay } from "@/lib/dates";
import { run, UserError, type ActionResult } from "@/lib/action-result";
import { isDemoMode } from "@/lib/demo-guard";
import { TxnType, Frequency } from "@/generated/prisma/enums";

const recurringSchema = z.object({
  frequency: z.enum(Frequency),
  interval: z.coerce.number().int().min(1).max(366).default(1),
  dayOfMonth: z.coerce.number().int().min(1).max(31).optional().nullable(),
  weekday: z.coerce.number().int().min(0).max(6).optional().nullable(),
  endDate: z.string().optional().nullable(),
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
});

export type TransactionInput = z.input<typeof txnSchema>;

async function assertOwnership(userId: string, accountId?: string | null, categoryId?: string | null) {
  if (accountId) {
    const a = await prisma.financialAccount.findFirst({ where: { id: accountId, userId } });
    if (!a) throw new UserError("Account not found");
  }
  if (categoryId) {
    const c = await prisma.category.findFirst({ where: { id: categoryId, userId } });
    if (!c) throw new UserError("Category not found");
  }
}

export async function createTransactionAction(input: TransactionInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const data = txnSchema.parse(input);
    await assertOwnership(userId, data.accountId, data.categoryId);

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
          categoryId: data.categoryId || null,
          type: data.type,
          amount: data.amount,
          date: parseISODay(data.date),
          description: data.description,
          note: data.note || null,
          cleared: data.cleared ?? true,
          recurringRuleId,
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
    await assertOwnership(userId, data.accountId, data.categoryId);

    await prisma.transaction.update({
      where: { id },
      data: {
        accountId: data.accountId || null,
        categoryId: data.categoryId || null,
        type: data.type,
        amount: data.amount,
        date: parseISODay(data.date),
        description: data.description,
        note: data.note || null,
        cleared: data.cleared ?? existing.cleared,
      },
    });
    revalidateAll();
  });
}

export async function deleteTransactionAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const existing = await prisma.transaction.findFirst({ where: { id, userId } });
    if (!existing) throw new UserError("Transaction not found");
    await prisma.transaction.delete({ where: { id } });
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
    await prisma.transaction.updateMany({ where: { userId, id: { in: list } }, data: { categoryId } });
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
    await prisma.transaction.deleteMany({ where: { userId, id: { in: list } } });
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
