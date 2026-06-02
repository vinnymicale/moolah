"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { parseISODay } from "@/lib/dates";
import { run, type ActionResult } from "@/lib/action-result";
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

async function assertOwnership(householdId: string, accountId?: string | null, categoryId?: string | null) {
  if (accountId) {
    const a = await prisma.financialAccount.findFirst({ where: { id: accountId, householdId } });
    if (!a) throw new Error("Account not found");
  }
  if (categoryId) {
    const c = await prisma.category.findFirst({ where: { id: categoryId, householdId } });
    if (!c) throw new Error("Category not found");
  }
}

export async function createTransactionAction(input: TransactionInput): Promise<ActionResult> {
  return run(async () => {
    const { householdId, userId } = await requireHousehold();
    const data = txnSchema.parse(input);
    await assertOwnership(householdId, data.accountId, data.categoryId);

    let recurringRuleId: string | undefined;
    if (data.recurring) {
      const rule = await prisma.recurringRule.create({
        data: {
          householdId,
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

    await prisma.transaction.create({
      data: {
        householdId,
        accountId: data.accountId || null,
        categoryId: data.categoryId || null,
        createdById: userId,
        type: data.type,
        amount: data.amount,
        date: parseISODay(data.date),
        description: data.description,
        note: data.note || null,
        cleared: data.cleared ?? true,
        recurringRuleId,
      },
    });
    revalidateAll();
  });
}

export async function updateTransactionAction(id: string, input: TransactionInput): Promise<ActionResult> {
  return run(async () => {
    const { householdId } = await requireHousehold();
    const existing = await prisma.transaction.findFirst({ where: { id, householdId } });
    if (!existing) throw new Error("Transaction not found");
    const data = txnSchema.parse(input);
    await assertOwnership(householdId, data.accountId, data.categoryId);

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
  return run(async () => {
    const { householdId } = await requireHousehold();
    const existing = await prisma.transaction.findFirst({ where: { id, householdId } });
    if (!existing) throw new Error("Transaction not found");
    await prisma.transaction.delete({ where: { id } });
    revalidateAll();
  });
}

export async function setClearedAction(id: string, cleared: boolean): Promise<ActionResult> {
  return run(async () => {
    const { householdId } = await requireHousehold();
    const existing = await prisma.transaction.findFirst({ where: { id, householdId } });
    if (!existing) throw new Error("Transaction not found");
    await prisma.transaction.update({ where: { id }, data: { cleared } });
    revalidateAll();
  });
}

// ---------------------------------------------------------------------------
// Bulk operations (driven by multi-select on the Transactions list). Each is
// scoped to the household, so a stray id can never touch another household's
// data.
// ---------------------------------------------------------------------------

const idsSchema = z.array(z.string().min(1)).min(1, "Select at least one transaction").max(1000);

export async function bulkSetCategoryAction(ids: string[], categoryId: string | null): Promise<ActionResult> {
  return run(async () => {
    const { householdId } = await requireHousehold();
    const list = idsSchema.parse(ids);
    if (categoryId) {
      const c = await prisma.category.findFirst({ where: { id: categoryId, householdId } });
      if (!c) throw new Error("Category not found");
    }
    await prisma.transaction.updateMany({ where: { householdId, id: { in: list } }, data: { categoryId } });
    revalidateAll();
  });
}

export async function bulkSetAccountAction(ids: string[], accountId: string | null): Promise<ActionResult> {
  return run(async () => {
    const { householdId } = await requireHousehold();
    const list = idsSchema.parse(ids);
    if (accountId) {
      const a = await prisma.financialAccount.findFirst({ where: { id: accountId, householdId } });
      if (!a) throw new Error("Account not found");
    }
    await prisma.transaction.updateMany({ where: { householdId, id: { in: list } }, data: { accountId } });
    revalidateAll();
  });
}

export async function bulkSetClearedAction(ids: string[], cleared: boolean): Promise<ActionResult> {
  return run(async () => {
    const { householdId } = await requireHousehold();
    const list = idsSchema.parse(ids);
    await prisma.transaction.updateMany({ where: { householdId, id: { in: list } }, data: { cleared } });
    revalidateAll();
  });
}

export async function bulkDeleteTransactionsAction(ids: string[]): Promise<ActionResult> {
  return run(async () => {
    const { householdId } = await requireHousehold();
    const list = idsSchema.parse(ids);
    await prisma.transaction.deleteMany({ where: { householdId, id: { in: list } } });
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
  return run(async () => {
    const { householdId } = await requireHousehold();
    const txn = await prisma.transaction.findFirst({ where: { id, householdId } });
    if (!txn) throw new Error("Transaction not found");
    if (txn.recurringRuleId) throw new Error("This transaction is already part of a recurring series.");
    const data = convertSchema.parse(input);

    const rule = await prisma.recurringRule.create({
      data: {
        householdId,
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
    await prisma.transaction.update({ where: { id }, data: { recurringRuleId: rule.id } });

    revalidatePath("/recurring");
    revalidateAll();
  });
}

/**
 * Turn a projected recurring occurrence into a concrete transaction (e.g. when
 * a bill is actually paid). Idempotent per (rule, date).
 */
export async function materializeOccurrenceAction(ruleId: string, dateISO: string, cleared = true): Promise<ActionResult> {
  return run(async () => {
    const { householdId, userId } = await requireHousehold();
    const rule = await prisma.recurringRule.findFirst({ where: { id: ruleId, householdId } });
    if (!rule) throw new Error("Recurring rule not found");
    const date = parseISODay(dateISO);

    const existing = await prisma.transaction.findFirst({
      where: { householdId, recurringRuleId: ruleId, date },
    });
    if (existing) {
      await prisma.transaction.update({ where: { id: existing.id }, data: { cleared } });
    } else {
      await prisma.transaction.create({
        data: {
          householdId,
          accountId: rule.accountId,
          categoryId: rule.categoryId,
          createdById: userId,
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

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/transactions");
  revalidatePath("/trends");
}
