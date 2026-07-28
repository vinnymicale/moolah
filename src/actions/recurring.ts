"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { parseISODay } from "@/lib/dates";
import { run, UserError, type ActionResult } from "@/lib/action-result";
import { isDemoMode } from "@/lib/demo-guard";
import { normalizeDescription } from "@/lib/recurring-suggestions";
import { TxnType, Frequency } from "@/generated/prisma/enums";

const ruleSchema = z.object({
  type: z.enum(TxnType),
  amount: z.coerce.number().positive(),
  description: z.string().min(1).max(120),
  note: z.string().max(500).optional().nullable(),
  accountId: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  frequency: z.enum(Frequency),
  interval: z.coerce.number().int().min(1).max(366).default(1),
  dayOfMonth: z.coerce.number().int().min(1).max(31).optional().nullable(),
  weekday: z.coerce.number().int().min(0).max(6).optional().nullable(),
  startDate: z.string().min(1),
  endDate: z.string().optional().nullable(),
});

export type RecurringInput = z.input<typeof ruleSchema>;

function toData(data: z.infer<typeof ruleSchema>, userId: string) {
  return {
    userId,
    accountId: data.accountId || null,
    categoryId: data.categoryId || null,
    type: data.type,
    amount: data.amount,
    description: data.description,
    note: data.note || null,
    frequency: data.frequency,
    interval: data.interval ?? 1,
    dayOfMonth: data.dayOfMonth ?? null,
    weekday: data.weekday ?? null,
    startDate: parseISODay(data.startDate),
    endDate: data.endDate ? parseISODay(data.endDate) : null,
  };
}

export async function createRecurringAction(input: RecurringInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const data = ruleSchema.parse(input);
    await prisma.recurringRule.create({ data: toData(data, userId) });
    revalidateAll();
  });
}

export async function updateRecurringAction(id: string, input: RecurringInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const existing = await prisma.recurringRule.findFirst({ where: { id, userId } });
    if (!existing) throw new UserError("Recurring rule not found");
    const data = ruleSchema.parse(input);
    const { userId: _hid, ...rest } = toData(data, userId);
    void _hid;
    await prisma.recurringRule.update({ where: { id }, data: rest });
    revalidateAll();
  });
}

export async function deleteRecurringAction(id: string, deleteOccurrences = false): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const existing = await prisma.recurringRule.findFirst({ where: { id, userId } });
    if (!existing) throw new UserError("Recurring rule not found");
    if (deleteOccurrences) {
      await prisma.transaction.deleteMany({ where: { userId, recurringRuleId: id } });
    }
    await prisma.recurringRule.delete({ where: { id } });
    revalidateAll();
  });
}

/**
 * Link every unlinked transaction of `type` whose normalized description matches
 * `normalized` to `ruleId`, skipping `excludeId`. The normalized grouping isn't
 * expressible in SQL, so candidates are matched in memory. Returns the count.
 */
async function linkMatchingTransactions(
  userId: string,
  type: TxnType,
  normalized: string,
  ruleId: string,
  excludeId?: string,
): Promise<number> {
  const candidates = await prisma.transaction.findMany({
    where: { userId, deletedAt: null, type, recurringRuleId: null },
    select: { id: true, description: true },
  });
  const ids = candidates
    .filter((t) => t.id !== excludeId && normalizeDescription(t.description) === normalized)
    .map((t) => t.id);

  if (ids.length > 0) {
    await prisma.transaction.updateMany({
      where: { id: { in: ids }, userId },
      data: { recurringRuleId: ruleId },
    });
  }
  return ids.length;
}

/**
 * Tie a recurring suggestion to an existing rule the user already has. The
 * suggestion's transactions (same type, same normalized description, not yet
 * linked) are attached to the rule, which both records the history and stops the
 * suggestion from coming back - detection skips linked transactions, and their
 * bank descriptions then feed the dedup that hides covered merchants.
 *
 * `suggestionKey` is the detector's group key, "TYPE|normalized description".
 */
export async function linkSuggestionToRuleAction(ruleId: string, suggestionKey: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();

    const rule = await prisma.recurringRule.findFirst({ where: { id: ruleId, userId } });
    if (!rule) throw new UserError("Recurring rule not found");

    const sep = suggestionKey.indexOf("|");
    if (sep < 0) throw new UserError("Invalid suggestion");
    const type = suggestionKey.slice(0, sep);
    const normalized = suggestionKey.slice(sep + 1);
    if ((type !== "INCOME" && type !== "EXPENSE") || !normalized) {
      throw new UserError("Invalid suggestion");
    }

    await linkMatchingTransactions(userId, type as TxnType, normalized, ruleId);
    revalidateAll();
  });
}

/**
 * Tie one transaction to an existing rule, or clear the tie when `ruleId` is
 * null. With `alsoMatching`, the other unlinked transactions sharing its
 * normalized description are swept in too, which is how a merchant the
 * suggestion detector never flagged gets its whole history attached at once.
 *
 * Unlink is always single-transaction: a bulk unlink would be far too easy to
 * fire by accident, so `alsoMatching` is ignored on that path.
 */
export async function linkTransactionToRuleAction(
  transactionId: string,
  ruleId: string | null,
  alsoMatching = false,
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();

    const txn = await prisma.transaction.findFirst({
      where: { id: transactionId, userId, deletedAt: null },
      select: { id: true, type: true, description: true },
    });
    if (!txn) throw new UserError("Transaction not found");

    if (ruleId) {
      const rule = await prisma.recurringRule.findFirst({ where: { id: ruleId, userId } });
      if (!rule) throw new UserError("Recurring rule not found");
    }

    await prisma.transaction.update({
      where: { id: transactionId },
      data: { recurringRuleId: ruleId },
    });

    if (ruleId && alsoMatching) {
      await linkMatchingTransactions(
        userId,
        txn.type,
        normalizeDescription(txn.description),
        ruleId,
        transactionId,
      );
    }

    revalidateAll();
  });
}

export interface LinkableRule {
  id: string;
  description: string;
  frequency: Frequency;
  interval: number;
}

export type LinkOptions =
  | { ok: true; rules: LinkableRule[]; matchCount: number }
  | { ok: false; error: string };

/**
 * What the transaction modal needs to offer a link: the rules of the same type
 * (only those can plausibly be the same series) and how many other unlinked
 * transactions share this description, which labels the "also link N others"
 * checkbox. Both are fetched together because the modal always wants both.
 */
export async function getTransactionLinkOptionsAction(transactionId: string): Promise<LinkOptions> {
  if (isDemoMode()) return { ok: true, rules: [], matchCount: 0 };
  try {
    const { userId } = await requireUser();

    const txn = await prisma.transaction.findFirst({
      where: { id: transactionId, userId, deletedAt: null },
      select: { id: true, type: true, description: true },
    });
    if (!txn) return { ok: false, error: "Transaction not found" };

    const [rules, candidates] = await Promise.all([
      prisma.recurringRule.findMany({
        where: { userId, type: txn.type, archived: false },
        select: { id: true, description: true, frequency: true, interval: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.transaction.findMany({
        where: { userId, deletedAt: null, type: txn.type, recurringRuleId: null },
        select: { id: true, description: true },
      }),
    ]);

    const normalized = normalizeDescription(txn.description);
    const matchCount = candidates.filter(
      (c) => c.id !== transactionId && normalizeDescription(c.description) === normalized,
    ).length;

    return { ok: true, rules, matchCount };
  } catch (e) {
    console.error("Action failed:", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/recurring");
  revalidatePath("/transactions");
}
