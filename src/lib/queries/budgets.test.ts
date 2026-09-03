// Budget query tests, focused on the carryover chain: how far back it walks,
// where it stops, and what it does with overspend. Prisma is stubbed so each
// case can lay out an exact history of budgets and spending.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { findMany: vi.fn() },
    budget: { findMany: vi.fn() },
    transaction: { findMany: vi.fn() },
  },
}));

import { getBudgetMonth, getBudgetYear } from "./budgets";
import { prisma } from "@/lib/prisma";

const category = vi.mocked(prisma.category);
const budget = vi.mocked(prisma.budget);
const txn = vi.mocked(prisma.transaction);

const FOOD = { id: "c1", name: "Food", color: "#111", icon: "utensils", kind: "EXPENSE" };
const month = (iso: string) => new Date(`${iso}-01T00:00:00.000Z`);

type BudgetRow = { categoryId: string; month: Date; limit: number; rollover: boolean };
type TxnRow = { categoryId: string | null; amount: number; date: Date; splits: never[] };

const b = (iso: string, limit: number, rollover = true, categoryId = "c1"): BudgetRow => ({
  categoryId,
  month: month(iso),
  limit,
  rollover,
});
const t = (iso: string, amount: number, categoryId = "c1"): TxnRow => ({
  categoryId,
  amount,
  date: new Date(`${iso}-15T00:00:00.000Z`),
  splits: [],
});

/**
 * Wire the mocks for one target month. `history` is every budget row and every
 * transaction across all months; the stubs split them the way the real queries
 * would, so a test only has to describe the world once.
 */
function setup(targetISO: string, budgets: BudgetRow[], txns: TxnRow[], cats = [FOOD]) {
  const target = month(targetISO);
  category.findMany.mockResolvedValue(cats as never);
  budget.findMany.mockImplementation((async (args: { where: { month: Date | { gte: Date; lt: Date } } }) => {
    const m = args.where.month;
    if (m instanceof Date) return budgets.filter((row) => row.month.getTime() === m.getTime());
    return budgets.filter((row) => row.month >= m.gte && row.month < m.lt);
  }) as never);
  txn.findMany.mockImplementation((async (args: { where: { date: { gte: Date; lte: Date } } }) => {
    const { gte, lte } = args.where.date;
    return txns.filter((row) => row.date >= gte && row.date <= lte);
  }) as never);
  return target;
}

const line = async (targetISO: string) => (await getBudgetMonth("u1", `${targetISO}-01`))[0];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getBudgetMonth carryover", () => {
  it("is zero when rollover is off", async () => {
    setup("2026-03", [b("2026-03", 400, false), b("2026-02", 400)], [t("2026-02", 100)]);
    const result = await line("2026-03");
    expect(result).toMatchObject({ rollover: false, carryover: 0, effectiveLimit: 400 });
  });

  it("carries last month's leftover", async () => {
    setup("2026-03", [b("2026-03", 400), b("2026-02", 400, false)], [t("2026-02", 250)]);
    expect(await line("2026-03")).toMatchObject({ carryover: 150, effectiveLimit: 550 });
  });

  it("chains across several rolling months", async () => {
    // Jan under by 100, Feb under by 50, so March inherits 150.
    setup(
      "2026-03",
      [b("2026-03", 400), b("2026-02", 400), b("2026-01", 400, false)],
      [t("2026-01", 300), t("2026-02", 350)],
    );
    expect(await line("2026-03")).toMatchObject({ carryover: 150, effectiveLimit: 550 });
  });

  it("carries overspend forward as a negative", async () => {
    setup("2026-03", [b("2026-03", 400), b("2026-02", 400, false)], [t("2026-02", 500)]);
    expect(await line("2026-03")).toMatchObject({ carryover: -100, effectiveLimit: 300 });
  });

  it("nets an overspent month against an underspent one", async () => {
    setup(
      "2026-03",
      [b("2026-03", 400), b("2026-02", 400), b("2026-01", 400, false)],
      [t("2026-01", 250), t("2026-02", 500)],
    );
    expect(await line("2026-03")).toMatchObject({ carryover: 50, effectiveLimit: 450 });
  });

  it("stops at a month with rollover off, ignoring anything before it", async () => {
    // Feb has rollover off, so its own 100 leftover carries but January's does not.
    setup(
      "2026-03",
      [b("2026-03", 400), b("2026-02", 400, false), b("2026-01", 400, false)],
      [t("2026-01", 0), t("2026-02", 300)],
    );
    expect(await line("2026-03")).toMatchObject({ carryover: 100 });
  });

  it("stops at a month with no budget row", async () => {
    setup(
      "2026-03",
      [b("2026-03", 400), b("2026-02", 400), b("2025-12", 400, false)],
      [t("2025-12", 0), t("2026-02", 300)],
    );
    // January has no budget, so the chain ends after February.
    expect(await line("2026-03")).toMatchObject({ carryover: 100 });
  });

  it("crosses a year boundary", async () => {
    setup(
      "2026-01",
      [b("2026-01", 400), b("2025-12", 400), b("2025-11", 400, false)],
      [t("2025-11", 300), t("2025-12", 300)],
    );
    expect(await line("2026-01")).toMatchObject({ carryover: 200 });
  });

  it("does not look back further than the lookback window", async () => {
    const budgets = [b("2026-03", 400)];
    const txns: TxnRow[] = [];
    // A rolling budget stretching back well past the 24-month window.
    for (let i = 1; i <= 30; i += 1) {
      const d = new Date(Date.UTC(2026, 2 - i, 1));
      const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      budgets.push(b(iso, 400));
      txns.push(t(iso, 390)); // 10 left each month
    }
    setup("2026-03", budgets, txns);
    // 24 months of 10, not 30.
    expect(await line("2026-03")).toMatchObject({ carryover: 240 });
  });

  it("keeps each category's chain separate", async () => {
    const FUEL = { id: "c2", name: "Fuel", color: "#222", icon: "fuel", kind: "EXPENSE" };
    setup(
      "2026-03",
      [b("2026-03", 400), b("2026-02", 400, false), b("2026-03", 100, true, "c2"), b("2026-02", 100, false, "c2")],
      [t("2026-02", 300), t("2026-02", 40, "c2")],
      [FOOD, FUEL],
    );
    const lines = await getBudgetMonth("u1", "2026-03-01");
    expect(lines[0]).toMatchObject({ categoryId: "c1", carryover: 100 });
    expect(lines[1]).toMatchObject({ categoryId: "c2", carryover: 60 });
  });

  it("reports limit 0 for a category with no budget", async () => {
    setup("2026-03", [], [t("2026-03", 75)]);
    expect(await line("2026-03")).toMatchObject({ limit: 0, actual: 75, rollover: false, carryover: 0 });
  });

  it("ignores a prior month whose limit is zero", async () => {
    setup("2026-03", [b("2026-03", 400), b("2026-02", 0)], [t("2026-02", 0)]);
    expect(await line("2026-03")).toMatchObject({ carryover: 0 });
  });
});

describe("getBudgetYear", () => {
  it("buckets budgets and spending into their months", async () => {
    budget.findMany.mockResolvedValue([
      { categoryId: "c1", month: month("2026-01"), limit: 400 },
      { categoryId: "c2", month: month("2026-01"), limit: 100 },
      { categoryId: "c1", month: month("2026-03"), limit: 450 },
    ] as never);
    txn.findMany.mockResolvedValue([
      { date: new Date("2026-01-05T00:00:00.000Z"), amount: 120 },
      { date: new Date("2026-01-20T00:00:00.000Z"), amount: 80 },
      { date: new Date("2026-03-02T00:00:00.000Z"), amount: 500 },
    ] as never);

    const months = await getBudgetYear("u1", 2026);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ monthISO: "2026-01-01", label: "Jan", budget: 500, actual: 200 });
    expect(months[1]).toEqual({ monthISO: "2026-02-01", label: "Feb", budget: 0, actual: 0 });
    expect(months[2]).toEqual({ monthISO: "2026-03-01", label: "Mar", budget: 450, actual: 500 });
  });
});
