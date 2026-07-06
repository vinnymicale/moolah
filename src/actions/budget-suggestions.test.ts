// Action-layer tests for budget-suggestions.ts: demo-mode short-circuits,
// rule + detected merging, category joining/ownership, and the batch upsert.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { findMany: vi.fn() },
    budget: { findMany: vi.fn(), upsert: vi.fn() },
    recurringRule: { findMany: vi.fn() },
    transaction: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { getBudgetSuggestionsAction, applyBudgetSuggestionsAction } from "./budget-suggestions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

const requireUserMock = vi.mocked(requireUser);
const category = vi.mocked(prisma.category);
const budget = vi.mocked(prisma.budget);
const recurringRule = vi.mocked(prisma.recurringRule);
const transaction = vi.mocked(prisma.transaction);

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  requireUserMock.mockResolvedValue({ userId: "u1" } as Awaited<ReturnType<typeof requireUser>>);
  category.findMany.mockResolvedValue([]);
  budget.findMany.mockResolvedValue([]);
  recurringRule.findMany.mockResolvedValue([]);
  transaction.findMany.mockResolvedValue([]);
});

describe("demo mode", () => {
  beforeEach(() => {
    demoMode.value = true;
  });

  it("getBudgetSuggestionsAction returns canned suggestions without auth or db", async () => {
    const res = await getBudgetSuggestionsAction({ month: "2026-07-01" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.categories.length).toBeGreaterThan(0);
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(recurringRule.findMany).not.toHaveBeenCalled();
  });

  it("applyBudgetSuggestionsAction is a no-op success", async () => {
    const res = await applyBudgetSuggestionsAction({
      month: "2026-07-01",
      entries: [{ categoryId: "c1", limit: 100 }],
    });
    expect(res).toEqual({ ok: true });
    expect(budget.upsert).not.toHaveBeenCalled();
  });
});

describe("getBudgetSuggestionsAction", () => {
  it("merges rules and detected charges into per-category suggestions with category info and current limits", async () => {
    category.findMany.mockResolvedValue([
      { id: "cat-fun", name: "Fun", color: "#f00", icon: "party" },
      { id: "cat-bills", name: "Bills", color: "#00f", icon: "zap" },
    ] as never);
    budget.findMany.mockResolvedValue([{ categoryId: "cat-bills", limit: "80" }] as never);
    recurringRule.findMany.mockResolvedValue([
      {
        id: "r1", description: "Electric Co", amount: "75.50", type: "EXPENSE",
        categoryId: "cat-bills", frequency: "MONTHLY", interval: 1, startDate: new Date("2026-01-10T00:00:00Z"),
      },
    ] as never);
    // Four monthly Spotify charges -> detected recurring expense in cat-fun.
    transaction.findMany.mockResolvedValue(
      ["2026-03-05", "2026-04-05", "2026-05-05", "2026-06-05"].map((d, i) => ({
        date: new Date(`${d}T00:00:00Z`), description: "SPOTIFY USA", amount: "11.99",
        type: "EXPENSE", categoryId: "cat-fun", accountId: `a${i % 2}`, recurringRuleId: null,
      })) as never,
    );

    const res = await getBudgetSuggestionsAction({ month: "2026-07-01" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const bills = res.data.categories.find((c) => c.categoryId === "cat-bills");
    expect(bills).toMatchObject({ name: "Bills", currentLimit: 80, suggested: 76 });
    expect(bills!.items[0]).toMatchObject({ source: "rule", description: "Electric Co" });

    const fun = res.data.categories.find((c) => c.categoryId === "cat-fun");
    expect(fun).toMatchObject({ name: "Fun", currentLimit: 0, suggested: 12 });
    expect(fun!.items[0]).toMatchObject({ source: "detected" });

    // Last-6-month spend history (oldest first) rides along for sparklines
    // and coverage: Spotify hit Mar-Jun, Bills had no transactions at all.
    expect(fun!.recentTotals).toEqual([0, 0, 11.99, 11.99, 11.99, 11.99]);
    expect(bills!.recentTotals).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("skips detected charges already covered by a rule description", async () => {
    category.findMany.mockResolvedValue([{ id: "cat-fun", name: "Fun", color: "#f00", icon: "party" }] as never);
    recurringRule.findMany.mockResolvedValue([
      {
        id: "r1", description: "Spotify Premium", amount: "11.99", type: "EXPENSE",
        categoryId: "cat-fun", frequency: "MONTHLY", interval: 1, startDate: new Date("2026-01-10T00:00:00Z"),
      },
    ] as never);
    transaction.findMany.mockResolvedValue(
      ["2026-03-05", "2026-04-05", "2026-05-05", "2026-06-05"].map((d) => ({
        date: new Date(`${d}T00:00:00Z`), description: "SPOTIFY USA", amount: "11.99",
        type: "EXPENSE", categoryId: "cat-fun", accountId: "a1", recurringRuleId: null,
      })) as never,
    );

    const res = await getBudgetSuggestionsAction({ month: "2026-07-01" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const fun = res.data.categories.find((c) => c.categoryId === "cat-fun");
    // Only the rule contributes; the detected group fuzzy-matches it.
    expect(fun!.items).toHaveLength(1);
    expect(fun!.items[0].source).toBe("rule");
  });

  it("returns the top non-recurring expenses behind a typical-spending item", async () => {
    category.findMany.mockResolvedValue([{ id: "cat-groc", name: "Groceries", color: "#0f0", icon: "cart" }] as never);
    // Irregular grocery purchases across Mar-May (3 active months) plus one
    // rule-linked charge that must stay out of the breakdown.
    const groceries = [
      { date: "2026-03-03", description: "WHOLE FOODS", amount: "50" },
      { date: "2026-04-18", description: "WHOLE FOODS", amount: "60" },
      { date: "2026-05-09", description: "WHOLE FOODS", amount: "70" },
      { date: "2026-04-02", description: "TRADER JOES", amount: "20" },
      { date: "2026-05-21", description: "TRADER JOES", amount: "30" },
    ].map((t) => ({
      date: new Date(`${t.date}T00:00:00Z`), description: t.description, amount: t.amount,
      type: "EXPENSE", categoryId: "cat-groc", accountId: "a1", recurringRuleId: null,
    }));
    transaction.findMany.mockResolvedValue([
      ...groceries,
      {
        date: new Date("2026-04-10T00:00:00Z"), description: "COSTCO GAS", amount: "40",
        type: "EXPENSE", categoryId: "cat-groc", accountId: "a1", recurringRuleId: "r9",
      },
    ] as never);

    const res = await getBudgetSuggestionsAction({ month: "2026-07-01" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const groc = res.data.categories.find((c) => c.categoryId === "cat-groc");
    const typical = groc!.items.find((i) => i.source === "typical");
    expect(typical!.topExpenses).toEqual([
      { description: "WHOLE FOODS", total: 180, count: 3 },
      { description: "TRADER JOES", total: 50, count: 2 },
    ]);
  });

  it("counts uncategorized recurring charges instead of including them", async () => {
    recurringRule.findMany.mockResolvedValue([
      {
        id: "r1", description: "Mystery sub", amount: "9.99", type: "EXPENSE",
        categoryId: null, frequency: "MONTHLY", interval: 1, startDate: new Date("2026-01-10T00:00:00Z"),
      },
    ] as never);

    const res = await getBudgetSuggestionsAction({ month: "2026-07-01" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.categories).toHaveLength(0);
    expect(res.data.uncategorizedCount).toBe(1);
  });

  it("rejects a malformed month", async () => {
    const res = await getBudgetSuggestionsAction({ month: "julyish" });
    expect(res.ok).toBe(false);
  });
});

describe("applyBudgetSuggestionsAction", () => {
  it("upserts every entry in one transaction after verifying category ownership", async () => {
    category.findMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }] as never);
    const res = await applyBudgetSuggestionsAction({
      month: "2026-07-01",
      entries: [
        { categoryId: "c1", limit: 120 },
        { categoryId: "c2", limit: 45 },
      ],
    });
    expect(res).toEqual({ ok: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(budget.upsert).toHaveBeenCalledTimes(2);
    expect(budget.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_categoryId_month: { userId: "u1", categoryId: "c1", month: expect.any(Date) } },
        update: { limit: 120 },
        create: expect.objectContaining({ userId: "u1", categoryId: "c1", limit: 120 }),
      }),
    );
  });

  it("errors when an entry references a category the user does not own", async () => {
    category.findMany.mockResolvedValue([{ id: "c1" }] as never);
    const res = await applyBudgetSuggestionsAction({
      month: "2026-07-01",
      entries: [
        { categoryId: "c1", limit: 120 },
        { categoryId: "not-mine", limit: 45 },
      ],
    });
    expect(res.ok).toBe(false);
    expect(budget.upsert).not.toHaveBeenCalled();
  });

  it("rejects an empty entries list", async () => {
    const res = await applyBudgetSuggestionsAction({ month: "2026-07-01", entries: [] });
    expect(res.ok).toBe(false);
    expect(requireUserMock).not.toHaveBeenCalled();
  });

  it("rejects non-positive limits", async () => {
    const res = await applyBudgetSuggestionsAction({
      month: "2026-07-01",
      entries: [{ categoryId: "c1", limit: 0 }],
    });
    expect(res.ok).toBe(false);
  });
});
