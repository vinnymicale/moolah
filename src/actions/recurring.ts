"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { parseISODay } from "@/lib/dates";
import { run, type ActionResult } from "@/lib/action-result";
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
  return run(async () => {
    const { householdId } = await requireHousehold();
    const data = ruleSchema.parse(input);
    await prisma.recurringRule.create({ data: toData(data, householdId) });
    revalidateAll();
  });
}

export async function updateRecurringAction(id: string, input: RecurringInput): Promise<ActionResult> {
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

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/recurring");
  revalidatePath("/transactions");
}
