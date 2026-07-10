import { z } from "zod";
import { getBudgetMonth } from "@/lib/queries/budgets";
import { formatUSD } from "@/lib/money";
import type { TriggerDef } from "../types";

export const budgetPace: TriggerDef = {
  id: "budget-pace",
  label: "On pace to overspend",
  description: "At the current daily rate, a category will finish the month over budget.",
  group: "budgets",
  modes: ["sweep"],
  severity: "info",
  paramsSchema: z.object({}),
  paramFields: [],
  variables: [
    { name: "category", description: "Category name" },
    { name: "projected", description: "Projected month-end spend" },
    { name: "budget", description: "Effective budget limit" },
  ],
  defaultTemplate: {
    title: "{{category}} is on pace to overspend",
    body: "{{category}} projects to {{projected}} this month against a {{budget}} budget.",
  },
  sampleVars: { category: "Groceries", projected: "$620.00", budget: "$500.00" },
  async evaluate(ctx) {
    const day = Number(ctx.todayISO.slice(8, 10));
    if (day < 5) return []; // too little data to project
    const [year, monthNum] = ctx.todayISO.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
    const month = ctx.todayISO.slice(0, 7);
    const lines = await getBudgetMonth(ctx.userId, ctx.todayISO);
    const events = [];
    for (const l of lines) {
      if (l.effectiveLimit <= 0) continue;
      if (l.actual > l.effectiveLimit) continue; // budget-exceeded owns this
      const projected = (l.actual / day) * daysInMonth;
      if (projected <= l.effectiveLimit) continue;
      events.push({
        dedupeKey: `budget-pace:${l.categoryId}:${month}`,
        vars: {
          category: l.name,
          projected: formatUSD(projected),
          budget: formatUSD(l.effectiveLimit),
        },
      });
    }
    return events;
  },
};
