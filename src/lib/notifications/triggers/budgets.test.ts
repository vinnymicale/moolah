import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBudgetMonth } from "@/lib/queries/budgets";
import type { TriggerContext } from "../types";
import { budgetExceeded } from "./budget-exceeded";
import { budgetThreshold } from "./budget-threshold";
import { budgetPace } from "./budget-pace";

vi.mock("@/lib/queries/budgets", () => ({ getBudgetMonth: vi.fn() }));

const line = (over: Partial<{ categoryId: string; name: string; limit: number; actual: number; effectiveLimit: number }> = {}) => ({
  categoryId: "c1", name: "Groceries", color: "#888", icon: "cart",
  limit: 500, actual: 0, rollover: false, carryover: 0, effectiveLimit: 500,
  ...over,
});

const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
  userId: "u1",
  params: {},
  todayISO: "2026-07-15",
  now: new Date("2026-07-15T12:00:00Z"),
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("budget-exceeded", () => {
  it("fires per over-budget category with a monthly dedupe key", async () => {
    vi.mocked(getBudgetMonth).mockResolvedValue([
      line({ actual: 512.5 }),
      line({ categoryId: "c2", name: "Gas", actual: 100 }),
    ]);
    const events = await budgetExceeded.evaluate(ctx());
    expect(events).toEqual([
      {
        dedupeKey: "budget-exceeded:c1:2026-07",
        vars: { category: "Groceries", spent: "$512.50", budget: "$500.00", over: "$12.50" },
      },
    ]);
  });

  it("skips categories with no budget set", async () => {
    vi.mocked(getBudgetMonth).mockResolvedValue([line({ limit: 0, effectiveLimit: 0, actual: 900 })]);
    expect(await budgetExceeded.evaluate(ctx())).toEqual([]);
  });

  it("honors the category filter", async () => {
    vi.mocked(getBudgetMonth).mockResolvedValue([
      line({ actual: 600 }),
      line({ categoryId: "c2", name: "Gas", actual: 600 }),
    ]);
    const events = await budgetExceeded.evaluate(ctx({ params: { categoryId: "c2" } }));
    expect(events).toHaveLength(1);
    expect(events[0].vars.category).toBe("Gas");
  });
});

describe("budget-threshold", () => {
  it("fires at or above the percent with percent in the dedupe key", async () => {
    vi.mocked(getBudgetMonth).mockResolvedValue([line({ actual: 400 })]);
    const events = await budgetThreshold.evaluate(ctx({ params: { percent: 80 } }));
    expect(events).toEqual([
      {
        dedupeKey: "budget-threshold:c1:2026-07:80",
        vars: { category: "Groceries", percent: "80", spent: "$400.00", budget: "$500.00" },
      },
    ]);
  });

  it("is silent below the percent", async () => {
    vi.mocked(getBudgetMonth).mockResolvedValue([line({ actual: 399 })]);
    expect(await budgetThreshold.evaluate(ctx({ params: { percent: 80 } }))).toEqual([]);
  });
});

describe("budget-pace", () => {
  it("fires when the projected month-end spend exceeds the budget", async () => {
    // Day 15 of a 31-day month: 300 spent projects to 620 > 500.
    vi.mocked(getBudgetMonth).mockResolvedValue([line({ actual: 300 })]);
    const events = await budgetPace.evaluate(ctx());
    expect(events).toHaveLength(1);
    expect(events[0].dedupeKey).toBe("budget-pace:c1:2026-07");
    expect(events[0].vars.category).toBe("Groceries");
    expect(events[0].vars.budget).toBe("$500.00");
    expect(events[0].vars.projected).toBe("$620.00");
  });

  it("stays quiet in the first days of the month (too noisy to project)", async () => {
    vi.mocked(getBudgetMonth).mockResolvedValue([line({ actual: 300 })]);
    expect(await budgetPace.evaluate(ctx({ todayISO: "2026-07-03" }))).toEqual([]);
  });

  it("defers to budget-exceeded once the budget is actually blown", async () => {
    vi.mocked(getBudgetMonth).mockResolvedValue([line({ actual: 501 })]);
    expect(await budgetPace.evaluate(ctx())).toEqual([]);
  });
});
