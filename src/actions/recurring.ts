"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { parseISODay } from "@/lib/dates";
import { run, type ActionResult } from "@/lib/action-result";
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

function toData(data: z.infer<typeof ruleSchema>, householdId: string) {
  return {
    householdId,
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
    const { householdId } = await requireHousehold();
    const data = ruleSchema.parse(input);
    await prisma.recurringRule.create({ data: toData(data, householdId) });
    revalidateAll();
  });
}

export async function updateRecurringAction(id: string, input: RecurringInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId } = await requireHousehold();
    const existing = await prisma.recurringRule.findFirst({ where: { id, householdId } });
    if (!existing) throw new Error("Recurring rule not found");
    const data = ruleSchema.parse(input);
    const { householdId: _hid, ...rest } = toData(data, householdId);
    void _hid;
    await prisma.recurringRule.update({ where: { id }, data: rest });
    revalidateAll();
  });
}

export async function deleteRecurringAction(id: string, deleteOccurrences = false): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId } = await requireHousehold();
    const existing = await prisma.recurringRule.findFirst({ where: { id, householdId } });
    if (!existing) throw new Error("Recurring rule not found");
    if (deleteOccurrences) {
      await prisma.transaction.deleteMany({ where: { householdId, recurringRuleId: id } });
    }
    await prisma.recurringRule.delete({ where: { id } });
    revalidateAll();
  });
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
    const { householdId } = await requireHousehold();

    const rule = await prisma.recurringRule.findFirst({ where: { id: ruleId, householdId } });
    if (!rule) throw new Error("Recurring rule not found");

    const sep = suggestionKey.indexOf("|");
    const type = suggestionKey.slice(0, sep);
    const normalized = suggestionKey.slice(sep + 1);
    if (sep < 0 || (type !== "INCOME" && type !== "EXPENSE") || !normalized) {
      throw new Error("Invalid suggestion");
    }

    // The normalized grouping isn't expressible in SQL, so match in memory.
    const candidates = await prisma.transaction.findMany({
      where: { householdId, type: type as TxnType, recurringRuleId: null },
      select: { id: true, description: true },
    });
    const ids = candidates
      .filter((t) => normalizeDescription(t.description) === normalized)
      .map((t) => t.id);

    if (ids.length > 0) {
      await prisma.transaction.updateMany({
        where: { id: { in: ids }, householdId },
        data: { recurringRuleId: ruleId },
      });
    }
    revalidateAll();
  });
}

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/recurring");
  revalidatePath("/transactions");
}
