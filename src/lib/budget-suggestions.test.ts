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
