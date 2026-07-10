import { z } from "zod";
import { getBudgetMonth } from "@/lib/queries/budgets";
import { formatUSD } from "@/lib/money";
import type { TriggerDef } from "../types";

export const budgetExceeded: TriggerDef = {
  id: "budget-exceeded",
  label: "Budget exceeded",
  description: "A category's spending went over its budget this month.",
  group: "budgets",
  modes: ["sweep", "event"],
  severity: "warning",
  paramsSchema: z.object({
    categoryId: z.string().optional(),
  }),
  paramFields: [
    { key: "categoryId", label: "Category (all if empty)", kind: "select", optionsFrom: "category", optional: true },
  ],
  variables: [
    { name: "category", description: "Category name" },
    { name: "spent", description: "Amount spent this month" },
    { name: "budget", description: "Effective budget limit" },
    { name: "over", description: "Amount over budget" },
  ],
  defaultTemplate: {
    title: "{{category}} is over budget",
    body: "{{category}}: {{spent}} spent of {{budget}} ({{over}} over).",
  },
  sampleVars: { category: "Groceries", spent: "$512.50", budget: "$500.00", over: "$12.50" },
  async evaluate(ctx) {
    const { categoryId } = ctx.params as { categoryId?: string };
    const month = ctx.todayISO.slice(0, 7);
    const lines = await getBudgetMonth(ctx.userId, ctx.todayISO);
    return lines
      .filter((l) => l.effectiveLimit > 0 && l.actual > l.effectiveLimit)
      .filter((l) => !categoryId || l.categoryId === categoryId)
      .map((l) => ({
        dedupeKey: `budget-exceeded:${l.categoryId}:${month}`,
        vars: {
          category: l.name,
          spent: formatUSD(l.actual),
          budget: formatUSD(l.effectiveLimit),
          over: formatUSD(l.actual - l.effectiveLimit),
        },
      }));
  },
};
