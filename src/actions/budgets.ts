"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
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
    const { householdId } = await requireHousehold();
    const data = budgetSchema.parse(input);
    const category = await prisma.category.findFirst({ where: { id: data.categoryId, householdId } });
    if (!category) throw new UserError("Category not found");
    const month = parseISODay(data.month);

    if (data.limit <= 0) {
      await prisma.budget.deleteMany({ where: { householdId, categoryId: data.categoryId, month } });
    } else {
      await prisma.budget.upsert({
        where: { householdId_categoryId_month: { householdId, categoryId: data.categoryId, month } },
        update: { limit: data.limit },
        create: { householdId, categoryId: data.categoryId, month, limit: data.limit },
      });
    }
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
    const { householdId } = await requireHousehold();
    const { fromMonth, toMonth } = copySchema.parse(input);
    const from = parseISODay(fromMonth);
    const to = parseISODay(toMonth);

    const prior = await prisma.budget.findMany({ where: { householdId, month: from } });
    if (prior.length === 0) throw new UserError("No budgets in that month to copy.");

    await prisma.$transaction(
      prior.map((b) =>
        prisma.budget.upsert({
          where: { householdId_categoryId_month: { householdId, categoryId: b.categoryId, month: to } },
          update: { limit: b.limit },
          create: { householdId, categoryId: b.categoryId, month: to, limit: b.limit },
        }),
      ),
    );

    revalidatePath("/budgets");
    revalidatePath("/trends");
    revalidatePath("/");
  });
}
