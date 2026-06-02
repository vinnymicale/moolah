"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { parseISODay } from "@/lib/dates";
import { run, type ActionResult } from "@/lib/action-result";

const budgetSchema = z.object({
  categoryId: z.string().min(1),
  month: z.string().min(1),
  limit: z.coerce.number().min(0),
});

export type BudgetInput = z.input<typeof budgetSchema>;

/** Create or update a category budget for a given month. A limit of 0 removes it. */
export async function setBudgetAction(input: BudgetInput): Promise<ActionResult> {
  return run(async () => {
    const { householdId } = await requireHousehold();
    const data = budgetSchema.parse(input);
    const category = await prisma.category.findFirst({ where: { id: data.categoryId, householdId } });
    if (!category) throw new Error("Category not found");
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
  });
}
