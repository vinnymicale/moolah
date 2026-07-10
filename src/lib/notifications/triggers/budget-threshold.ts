import { z } from "zod";
import { getBudgetMonth } from "@/lib/queries/budgets";
import { formatUSD } from "@/lib/money";
import type { TriggerDef } from "../types";

export const budgetThreshold: TriggerDef = {
  id: "budget-threshold",
  label: "Approaching a budget",
  description: "A category's spending crossed a percent of its budget this month.",
  group: "budgets",
  modes: ["sweep", "event"],
  severity: "info",
  paramsSchema: z.object({
    percent: z.number().int().min(1).max(100).default(80),
    categoryId: z.string().optional(),
  }),
  paramFields: [
    { key: "percent", label: "Percent of budget", kind: "number", min: 1, max: 100 },
    { key: "categoryId", label: "Category (all if empty)", kind: "select", optionsFrom: "category", optional: true },
  ],
  variables: [
    { name: "category", description: "Category name" },
    { name: "percent", description: "Threshold percent" },
    { name: "spent", description: "Amount spent this month" },
    { name: "budget", description: "Effective budget limit" },
  ],
  defaultTemplate: {
    title: "{{category}} is at {{percent}}% of budget",
    body: "{{category}}: {{spent}} spent of {{budget}}.",
  },
  sampleVars: { category: "Groceries", percent: "80", spent: "$400.00", budget: "$500.00" },
  async evaluate(ctx) {
    const { percent, categoryId } = ctx.params as { percent: number; categoryId?: string };
    const month = ctx.todayISO.slice(0, 7);
    const lines = await getBudgetMonth(ctx.userId, ctx.todayISO);
    return lines
      .filter((l) => l.effectiveLimit > 0 && (l.actual / l.effectiveLimit) * 100 >= percent)
      .filter((l) => !categoryId || l.categoryId === categoryId)
      .map((l) => ({
        dedupeKey: `budget-threshold:${l.categoryId}:${month}:${percent}`,
        vars: {
          category: l.name,
          percent: String(percent),
          spent: formatUSD(l.actual),
          budget: formatUSD(l.effectiveLimit),
        },
      }));
  },
};
