import { describe, expect, it } from "vitest";
import {
  buildBudgetSuggestions,
  monthlyAmount,
  type DetectedForBudget,
  type RuleForBudget,
} from "./budget-suggestions";

function rule(overrides: Partial<RuleForBudget> = {}): RuleForBudget {
  return {
    id: "r1",
    description: "Netflix",
    amount: 15.49,
    type: "EXPENSE",
    categoryId: "cat-fun",
    frequency: "MONTHLY",
    interval: 1,
    ...overrides,
  };
}

function detected(overrides: Partial<DetectedForBudget> = {}): DetectedForBudget {
  return {
    key: "EXPENSE|spotify",
    description: "Spotify",
    amount: 11.99,
    type: "EXPENSE",
    frequency: "MONTHLY",
    interval: 1,
    categoryId: "cat-fun",
    cadence: "about monthly",
    startDate: "2026-06-15",
    ...overrides,
  };
}

describe("monthlyAmount", () => {
  it("returns the amount unchanged for monthly", () => {
    expect(monthlyAmount(15.49, "MONTHLY", 1)).toBe(15.49);
  });

  it("scales weekly to 52/12 months", () => {
    // $12/week -> 1200c * 52 / 12 = 5200c
    expect(monthlyAmount(12, "WEEKLY", 1)).toBe(52);
  });

  it("scales biweekly to 26/12 months", () => {
    expect(monthlyAmount(12, "BIWEEKLY", 1)).toBe(26);
  });

  it("divides yearly by 12", () => {
    expect(monthlyAmount(120, "YEARLY", 1)).toBe(10);
  });

  it("scales daily to 365/12 months", () => {
    // 100c * 365/12 = 3041.67c -> rounds to 3042c
    expect(monthlyAmount(1, "DAILY", 1)).toBe(30.42);
  });

  it("divides by the interval", () => {
    // every 2 months: $30 -> $15/month
    expect(monthlyAmount(30, "MONTHLY", 2)).toBe(15);
  });
});

describe("buildBudgetSuggestions", () => {
  it("groups rule and detected charges by category and rounds the total up to whole dollars", () => {
    const res = buildBudgetSuggestions({
      rules: [rule({ id: "r1", amount: 15.49 })],
      detected: [detected({ amount: 11.99 })],
    });
    expect(res.categories).toHaveLength(1);
    const cat = res.categories[0];
    expect(cat.categoryId).toBe("cat-fun");
    // 15.49 + 11.99 = 27.48 -> rounds up to 28
    expect(cat.suggested).toBe(28);
    expect(cat.items).toHaveLength(2);
  });

  it("tags items with their source and monthly amount", () => {
    const res = buildBudgetSuggestions({
      rules: [rule({ amount: 120, frequency: "YEARLY" })],
      detected: [detected()],
    });
    const items = res.categories[0].items;
    const ruleItem = items.find((i) => i.source === "rule");
    const detectedItem = items.find((i) => i.source === "detected");
    expect(ruleItem).toMatchObject({ id: "r1", monthlyAmount: 10 });
    expect(detectedItem).toMatchObject({ id: "EXPENSE|spotify", monthlyAmount: 11.99 });
  });

  it("excludes income items entirely", () => {
    const res = buildBudgetSuggestions({
      rules: [rule({ type: "INCOME", categoryId: "cat-pay" })],
      detected: [detected({ type: "INCOME", categoryId: "cat-pay" })],
    });
    expect(res.categories).toHaveLength(0);
    expect(res.uncategorized).toHaveLength(0);
  });

  it("puts uncategorized charges in a separate list, not in category totals", () => {
    const res = buildBudgetSuggestions({
      rules: [rule({ categoryId: null })],
      detected: [detected()],
    });
    expect(res.categories).toHaveLength(1);
    expect(res.categories[0].suggested).toBe(12); // 11.99 rounded up
    expect(res.uncategorized).toHaveLength(1);
    expect(res.uncategorized[0].id).toBe("r1");
  });

  it("sorts categories by suggested amount descending and items by monthly amount descending", () => {
    const res = buildBudgetSuggestions({
      rules: [
        rule({ id: "small", amount: 5, categoryId: "cat-a" }),
        rule({ id: "big", amount: 500, categoryId: "cat-b" }),
        rule({ id: "bigger-item", amount: 20, categoryId: "cat-a" }),
      ],
      detected: [],
    });
    expect(res.categories.map((c) => c.categoryId)).toEqual(["cat-b", "cat-a"]);
    expect(res.categories[1].items.map((i) => i.id)).toEqual(["bigger-item", "small"]);
  });

  it("labels rule cadence from frequency and interval", () => {
    const res = buildBudgetSuggestions({
      rules: [
        rule({ id: "m", frequency: "MONTHLY", interval: 1 }),
        rule({ id: "q", frequency: "MONTHLY", interval: 3 }),
        rule({ id: "w", frequency: "WEEKLY", interval: 1 }),
        rule({ id: "y", frequency: "YEARLY", interval: 1 }),
      ],
      detected: [],
    });
    const byId = new Map(res.categories[0].items.map((i) => [i.id, i.cadence]));
    expect(byId.get("m")).toBe("monthly");
    expect(byId.get("q")).toBe("every 3 months");
    expect(byId.get("w")).toBe("weekly");
    expect(byId.get("y")).toBe("yearly");
  });

  it("passes through the detector's cadence label for detected items", () => {
    const res = buildBudgetSuggestions({
      rules: [],
      detected: [detected({ cadence: "every ~2 weeks", frequency: "BIWEEKLY" })],
    });
    expect(res.categories[0].items[0].cadence).toBe("every ~2 weeks");
  });

  it("returns empty results for no input", () => {
    const res = buildBudgetSuggestions({ rules: [], detected: [] });
    expect(res.categories).toEqual([]);
    expect(res.uncategorized).toEqual([]);
  });
});

describe("stale detected charges", () => {
  it("flags a detected charge whose last occurrence is far older than its cadence and drops it from the total", () => {
    const res = buildBudgetSuggestions({
      monthISO: "2026-07-01",
      rules: [],
      detected: [
        // Monthly charge last seen ~4 months before the target month.
        detected({ key: "EXPENSE|old", description: "Old Gym", startDate: "2026-03-02", amount: 40 }),
        detected({ key: "EXPENSE|spotify", startDate: "2026-06-15" }),
      ],
    });
    const cat = res.categories[0];
    const old = cat.items.find((i) => i.id === "EXPENSE|old")!;
    const fresh = cat.items.find((i) => i.id === "EXPENSE|spotify")!;
    expect(old.stale).toBe(true);
    expect(fresh.stale).toBeFalsy();
    // Only the fresh 11.99 counts: rounds up to 12, not 52.
    expect(cat.suggested).toBe(12);
  });

  it("does not flag anything when no target month is given", () => {
    const res = buildBudgetSuggestions({
      rules: [],
      detected: [detected({ startDate: "2025-01-01" })],
    });
    expect(res.categories[0].items[0].stale).toBeFalsy();
  });

  it("never flags rule-based charges", () => {
    const res = buildBudgetSuggestions({
      monthISO: "2026-07-01",
      rules: [rule()],
      detected: [],
    });
    expect(res.categories[0].items[0].stale).toBeFalsy();
  });
});

describe("yearly charges with a target month", () => {
  it("counts a yearly rule at full amount when its anniversary falls in the target month", () => {
    const res = buildBudgetSuggestions({
      monthISO: "2026-07-01",
      rules: [rule({ amount: 120, frequency: "YEARLY", startDate: "2024-07-15" })],
      detected: [],
    });
    const item = res.categories[0].items[0];
    expect(item.monthlyAmount).toBe(120);
    expect(res.categories[0].suggested).toBe(120);
    expect(item.cadence).toContain("due this month");
  });

  it("counts a yearly rule as zero in months it is not due", () => {
    const res = buildBudgetSuggestions({
      monthISO: "2026-07-01",
      rules: [rule({ amount: 120, frequency: "YEARLY", startDate: "2024-03-15" })],
      detected: [],
    });
    const item = res.categories[0].items[0];
    expect(item.monthlyAmount).toBe(0);
    expect(res.categories[0].suggested).toBe(0);
    expect(item.cadence).toContain("next due Mar");
  });

  it("uses the last-seen month for detected yearly charges", () => {
    const res = buildBudgetSuggestions({
      monthISO: "2026-07-01",
      rules: [],
      detected: [
        detected({ key: "EXPENSE|ins", frequency: "YEARLY", amount: 600, startDate: "2025-07-10", cadence: "about yearly" }),
      ],
    });
    expect(res.categories[0].items[0].monthlyAmount).toBe(600);
  });

  it("keeps smoothing yearly amounts when no target month is given", () => {
    const res = buildBudgetSuggestions({
      rules: [rule({ amount: 120, frequency: "YEARLY", startDate: "2024-03-15" })],
      detected: [],
    });
    expect(res.categories[0].items[0].monthlyAmount).toBe(10);
  });
});

describe("variable spend suggestions", () => {
  it("adds a typical-spending item from the median of monthly totals for a category with no recurring charges", () => {
    const res = buildBudgetSuggestions({
      rules: [],
      detected: [],
      variableSpend: [{ categoryId: "cat-groceries", monthlyTotals: [200, 250, 300, 220, 0, 240] }],
    });
    expect(res.categories).toHaveLength(1);
    const cat = res.categories[0];
    expect(cat.categoryId).toBe("cat-groceries");
    const item = cat.items[0];
    expect(item.source).toBe("typical");
    // median of [0, 200, 220, 240, 250, 300] = 230
    expect(item.monthlyAmount).toBe(230);
    expect(cat.suggested).toBe(230);
  });

  it("subtracts the category's recurring total so charges are not double-counted", () => {
    const res = buildBudgetSuggestions({
      rules: [rule({ amount: 60, categoryId: "cat-fun" })],
      detected: [],
      variableSpend: [{ categoryId: "cat-fun", monthlyTotals: [100, 100, 100, 100] }],
    });
    const cat = res.categories[0];
    const typical = cat.items.find((i) => i.source === "typical")!;
    expect(typical.monthlyAmount).toBe(40);
    expect(cat.suggested).toBe(100);
  });

  it("skips categories with fewer than 3 months of spend", () => {
    const res = buildBudgetSuggestions({
      rules: [],
      detected: [],
      variableSpend: [{ categoryId: "cat-rare", monthlyTotals: [0, 0, 500, 0, 120, 0] }],
    });
    expect(res.categories).toHaveLength(0);
  });

  it("skips the typical item when recurring charges already cover the median", () => {
    const res = buildBudgetSuggestions({
      rules: [rule({ amount: 100, categoryId: "cat-fun" })],
      detected: [],
      variableSpend: [{ categoryId: "cat-fun", monthlyTotals: [90, 95, 100, 92] }],
    });
    const cat = res.categories[0];
    expect(cat.items.filter((i) => i.source === "typical")).toHaveLength(0);
    expect(cat.suggested).toBe(100);
  });

  it("carries the category's top expenses onto the typical item so the UI can show what's behind the number", () => {
    const topExpenses = [
      { description: "WHOLE FOODS", total: 610.4, count: 9 },
      { description: "TRADER JOES", total: 280.15, count: 6 },
    ];
    const res = buildBudgetSuggestions({
      rules: [],
      detected: [],
      variableSpend: [{ categoryId: "cat-groceries", monthlyTotals: [200, 250, 300, 220, 0, 240], topExpenses }],
    });
    expect(res.categories[0].items[0].topExpenses).toEqual(topExpenses);
  });

  it("ignores stale recurring charges when computing the recurring total to subtract", () => {
    const res = buildBudgetSuggestions({
      monthISO: "2026-07-01",
      rules: [],
      detected: [detected({ key: "EXPENSE|old", startDate: "2026-01-05", amount: 50, categoryId: "cat-fun" })],
      variableSpend: [{ categoryId: "cat-fun", monthlyTotals: [80, 80, 80, 80] }],
    });
    const cat = res.categories[0];
    const typical = cat.items.find((i) => i.source === "typical")!;
    // Stale charge contributes nothing, so the full 80 median stands.
    expect(typical.monthlyAmount).toBe(80);
    expect(cat.suggested).toBe(80);
  });
});
