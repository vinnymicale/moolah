"use server";

// Budget suggestions: compute a suggested monthly budget per expense category
// from saved recurring rules plus recurring charges detected in transaction
// history, and batch-apply the amounts the user accepts.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { isDemoMode } from "@/lib/demo-guard";
import { run, UserError, type ActionResult } from "@/lib/action-result";
import { toNumber } from "@/lib/money";
import { isoDay, parseISODay, startOfUTCMonth, addUTCMonths } from "@/lib/dates";
import { detectRecurringCandidates } from "@/lib/recurring-suggestions";
import {
  buildBudgetSuggestions,
  type BudgetSuggestionsDTO,
  type RuleForBudget,
  type SuggestedCategoryDTO,
} from "@/lib/budget-suggestions";
import { DEMO_BUDGET_SUGGESTIONS } from "@/lib/demo-data";

const monthSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid month");

const getSchema = z.object({ month: monthSchema });

type GetResult = { ok: true; data: BudgetSuggestionsDTO } | { ok: false; error: string };

export async function getBudgetSuggestionsAction(input: { month: string }): Promise<GetResult> {
  const parsed = getSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid month" };

  if (isDemoMode()) return { ok: true, data: DEMO_BUDGET_SUGGESTIONS };

  try {
    const { userId } = await requireUser();
    const monthStart = startOfUTCMonth(parseISODay(parsed.data.month));
    const since = startOfUTCMonth(addUTCMonths(monthStart, -12));

    const [rules, txns, cats, budgets] = await Promise.all([
      prisma.recurringRule.findMany({ where: { userId } }),
      prisma.transaction.findMany({
        where: { userId, deletedAt: null, isTransfer: false, date: { gte: since } },
        select: {
          date: true,
          description: true,
          amount: true,
          type: true,
          categoryId: true,
          accountId: true,
          recurringRuleId: true,
        },
        orderBy: { date: "asc" },
      }),
      prisma.category.findMany({
        where: { userId, kind: "EXPENSE" },
        select: { id: true, name: true, color: true, icon: true },
      }),
      prisma.budget.findMany({ where: { userId, month: monthStart } }),
    ]);

    // Dedupe detection against every rule the user has (any type/state) plus
    // descriptions of transactions already linked to a rule - same approach
    // as the Recurring page's suggestion list.
    const linkedDescriptions = txns.filter((t) => t.recurringRuleId).map((t) => t.description);
    const existingDescriptions = [...rules.map((r) => r.description), ...linkedDescriptions];

    const detected = detectRecurringCandidates(
      txns.map((t) => ({
        date: isoDay(t.date),
        description: t.description,
        amount: toNumber(t.amount),
        type: t.type as "INCOME" | "EXPENSE",
        categoryId: t.categoryId,
        accountId: t.accountId,
        recurringRuleId: t.recurringRuleId,
      })),
      { existingDescriptions, limit: 100 },
    );

    // Only active rules contribute amounts: not archived, not ended before
    // the target month (an ended subscription shouldn't inflate the budget).
    const activeRules: RuleForBudget[] = rules
      .filter((r) => !r.archived && (!r.endDate || r.endDate >= monthStart))
      .map((r) => ({
        id: r.id,
        description: r.description,
        amount: toNumber(r.amount),
        type: r.type as "INCOME" | "EXPENSE",
        categoryId: r.categoryId,
        frequency: r.frequency as RuleForBudget["frequency"],
        interval: r.interval,
      }));

    const suggestions = buildBudgetSuggestions({ rules: activeRules, detected });

    const catById = new Map(cats.map((c) => [c.id, c]));
    const limitByCat = new Map(budgets.map((b) => [b.categoryId, toNumber(b.limit)]));

    const categories: SuggestedCategoryDTO[] = [];
    for (const s of suggestions.categories) {
      const cat = catById.get(s.categoryId);
      if (!cat) continue; // non-expense or deleted category
      categories.push({
        ...s,
        name: cat.name,
        color: cat.color,
        icon: cat.icon,
        currentLimit: limitByCat.get(s.categoryId) ?? 0,
      });
    }

    return { ok: true, data: { categories, uncategorizedCount: suggestions.uncategorized.length } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to build suggestions" };
  }
}

const applySchema = z.object({
  month: monthSchema,
  entries: z
    .array(
      z.object({
        categoryId: z.string().min(1),
        limit: z.number().positive("Budget must be positive"),
      }),
    )
    .min(1, "Nothing to apply"),
});

export async function applyBudgetSuggestionsAction(input: {
  month: string;
  entries: { categoryId: string; limit: number }[];
}): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };

  return run(async () => {
    const { month, entries } = applySchema.parse(input);
    const { userId } = await requireUser();
    const monthStart = startOfUTCMonth(parseISODay(month));

    const ids = [...new Set(entries.map((e) => e.categoryId))];
    const owned = await prisma.category.findMany({
      where: { userId, id: { in: ids } },
      select: { id: true },
    });
    if (owned.length !== ids.length) throw new UserError("Category not found");

    await prisma.$transaction(
      entries.map((e) =>
        prisma.budget.upsert({
          where: { userId_categoryId_month: { userId, categoryId: e.categoryId, month: monthStart } },
          update: { limit: e.limit },
          create: { userId, categoryId: e.categoryId, month: monthStart, limit: e.limit },
        }),
      ),
    );

    revalidatePath("/budgets");
    revalidatePath("/trends");
    revalidatePath("/");
  });
}
