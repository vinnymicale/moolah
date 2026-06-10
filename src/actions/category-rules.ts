"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { run, UserError, type ActionResult } from "@/lib/action-result";
import { isDemoMode } from "@/lib/demo-guard";
import { matchCategoryRule } from "@/lib/category-rules";

const ruleSchema = z.object({
  pattern: z.string().trim().min(2, "Pattern must be at least 2 characters").max(80),
  categoryId: z.string().min(1, "Pick a category"),
});

export type CategoryRuleInput = z.input<typeof ruleSchema>;

export async function createCategoryRuleAction(input: CategoryRuleInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId } = await requireHousehold();
    const data = ruleSchema.parse(input);
    const category = await prisma.category.findFirst({ where: { id: data.categoryId, householdId } });
    if (!category) throw new UserError("Category not found");
    const existing = await prisma.categoryRule.findFirst({
      where: { householdId, pattern: { equals: data.pattern, mode: "insensitive" } },
    });
    if (existing) throw new UserError("A rule with that pattern already exists.");
    await prisma.categoryRule.create({
      data: { householdId, pattern: data.pattern, categoryId: data.categoryId },
    });
    revalidatePath("/categories");
  });
}

export async function deleteCategoryRuleAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId } = await requireHousehold();
    const rule = await prisma.categoryRule.findFirst({ where: { id, householdId } });
    if (!rule) throw new UserError("Rule not found");
    await prisma.categoryRule.delete({ where: { id } });
    revalidatePath("/categories");
  });
}

/** Apply all rules to currently-uncategorized transactions. Never overwrites
 * a category the user already set. Returns how many rows were updated. */
export async function applyCategoryRulesAction(): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  if (isDemoMode()) return { ok: true, updated: 0 };
  try {
    const { householdId } = await requireHousehold();
    const rules = await prisma.categoryRule.findMany({ where: { householdId } });
    if (rules.length === 0) return { ok: true, updated: 0 };

    const uncategorized = await prisma.transaction.findMany({
      where: { householdId, categoryId: null },
      select: { id: true, description: true },
    });

    let updated = 0;
    for (const txn of uncategorized) {
      const categoryId = matchCategoryRule(txn.description, rules);
      if (!categoryId) continue;
      await prisma.transaction.update({ where: { id: txn.id }, data: { categoryId } });
      updated++;
    }

    revalidatePath("/categories");
    revalidatePath("/transactions");
    revalidatePath("/");
    return { ok: true, updated };
  } catch (e) {
    console.error("applyCategoryRules failed:", e);
    return { ok: false, error: "Could not apply rules. Please try again." };
  }
}
