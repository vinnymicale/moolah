"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { parseISODay } from "@/lib/dates";
import { run, UserError, type ActionResult } from "@/lib/action-result";
import { isDemoMode } from "@/lib/demo-guard";

const budgetSchema = z.object({
  categoryId: z.string().min(1),
  month: z.string().min(1),
  limit: z.coerce.number().min(0),
});

export type BudgetInput = z.input<typeof budgetSchema>;

/** Create or update a category budget for a given month. A limit of 0 removes it. */
export async function setBudgetAction(input: BudgetInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const data = budgetSchema.parse(input);
    const category = await prisma.category.findFirst({ where: { id: data.categoryId, userId } });
    if (!category) throw new UserError("Category not found");
    const month = parseISODay(data.month);

    if (data.limit <= 0) {
      await prisma.budget.deleteMany({ where: { userId, categoryId: data.categoryId, month } });
    } else {
      await prisma.budget.upsert({
        where: { userId_categoryId_month: { userId, categoryId: data.categoryId, month } },
        update: { limit: data.limit },
        create: { userId, categoryId: data.categoryId, month, limit: data.limit },
      });
    }
    revalidatePath("/trends");
    revalidatePath("/budgets");
    revalidatePath("/");
  });
}

const rolloverSchema = z.object({
  categoryId: z.string().min(1),
  month: z.string().min(1),
  rollover: z.boolean(),
});

export type BudgetRolloverInput = z.input<typeof rolloverSchema>;

/** Toggle whether last month's leftover carries into this month's limit. */
export async function setBudgetRolloverAction(input: BudgetRolloverInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const data = rolloverSchema.parse(input);
    const month = parseISODay(data.month);

    const updated = await prisma.budget.updateMany({
      where: { userId, categoryId: data.categoryId, month },
      data: { rollover: data.rollover },
    });
    if (updated.count === 0) throw new UserError("Set a budget for this month first.");

    revalidatePath("/trends");
    revalidatePath("/budgets");
    revalidatePath("/");
  });
}

const clearMonthSchema = z.object({
  month: z.string().min(1),
});

export type ClearMonthBudgetsInput = z.input<typeof clearMonthSchema>;

/** Delete every category budget for a given month. */
export async function clearMonthBudgetsAction(input: ClearMonthBudgetsInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const month = parseISODay(clearMonthSchema.parse(input).month);

    const deleted = await prisma.budget.deleteMany({ where: { userId, month } });
    if (deleted.count === 0) throw new UserError("No budgets set for this month.");

    revalidatePath("/trends");
    revalidatePath("/budgets");
    revalidatePath("/");
  });
}

const copySchema = z.object({
  fromMonth: z.string().min(1),
  toMonth: z.string().min(1),
});

export type CopyBudgetsInput = z.input<typeof copySchema>;

/** Copy every category limit from one month into another (upserting). */
export async function copyBudgetsAction(input: CopyBudgetsInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const { fromMonth, toMonth } = copySchema.parse(input);
    const from = parseISODay(fromMonth);
    const to = parseISODay(toMonth);

    const prior = await prisma.budget.findMany({ where: { userId, month: from } });
    if (prior.length === 0) throw new UserError("No budgets in that month to copy.");

    await prisma.$transaction(
      prior.map((b) =>
        prisma.budget.upsert({
          where: { userId_categoryId_month: { userId, categoryId: b.categoryId, month: to } },
          update: { limit: b.limit, rollover: b.rollover },
          create: { userId, categoryId: b.categoryId, month: to, limit: b.limit, rollover: b.rollover },
        }),
      ),
    );

    revalidatePath("/budgets");
    revalidatePath("/trends");
    revalidatePath("/");
  });
}
