// Action-layer tests for budgets.ts. These cover the demo-mode short-circuit,
// category ownership checks, the "limit <= 0 removes the budget" rule, and the
// copy-forward upsert - by stubbing prisma, session, and cache.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { findFirst: vi.fn() },
    budget: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { setBudgetAction, copyBudgetsAction, clearMonthBudgetsAction } from "./budgets";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

const requireUserMock = vi.mocked(requireUser);
const category = vi.mocked(prisma.category);
const budget = vi.mocked(prisma.budget);

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  requireUserMock.mockResolvedValue({ userId: "u1" } as Awaited<ReturnType<typeof requireUser>>);
});

describe("demo-mode guard", () => {
  beforeEach(() => {
    demoMode.value = true;
  });

  it("setBudgetAction is a no-op success in demo mode", async () => {
    expect(await setBudgetAction({ categoryId: "c1", month: "2026-06-01", limit: 100 })).toEqual({ ok: true });
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(budget.upsert).not.toHaveBeenCalled();
  });

  it("copyBudgetsAction is a no-op success in demo mode", async () => {
    expect(await copyBudgetsAction({ fromMonth: "2026-05-01", toMonth: "2026-06-01" })).toEqual({ ok: true });
    expect(budget.findMany).not.toHaveBeenCalled();
  });

  it("clearMonthBudgetsAction is a no-op success in demo mode", async () => {
    expect(await clearMonthBudgetsAction({ month: "2026-06-01" })).toEqual({ ok: true });
    expect(budget.deleteMany).not.toHaveBeenCalled();
  });
});

describe("clearMonthBudgetsAction", () => {
  it("deletes every budget in the month for the user", async () => {
    budget.deleteMany.mockResolvedValue({ count: 3 } as never);
    const result = await clearMonthBudgetsAction({ month: "2026-06-01" });
    expect(result).toEqual({ ok: true });
    expect(budget.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", month: expect.any(Date) },
    });
  });

  it("errors when the month has no budgets", async () => {
    budget.deleteMany.mockResolvedValue({ count: 0 } as never);
    const result = await clearMonthBudgetsAction({ month: "2026-06-01" });
    expect(result).toEqual({ ok: false, error: "No budgets set for this month." });
  });
});

describe("setBudgetAction", () => {
  it("errors when the category is not owned by the user", async () => {
    category.findFirst.mockResolvedValue(null);
    const result = await setBudgetAction({ categoryId: "c1", month: "2026-06-01", limit: 100 });
    expect(result).toEqual({ ok: false, error: "Category not found" });
    expect(budget.upsert).not.toHaveBeenCalled();
  });

  it("upserts a positive limit", async () => {
    category.findFirst.mockResolvedValue({ id: "c1" } as never);
    const result = await setBudgetAction({ categoryId: "c1", month: "2026-06-01", limit: 250 });
    expect(result).toEqual({ ok: true });
    expect(budget.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_categoryId_month: { userId: "u1", categoryId: "c1", month: expect.any(Date) } },
        update: { limit: 250 },
        create: expect.objectContaining({ userId: "u1", categoryId: "c1", limit: 250 }),
      }),
    );
    expect(budget.deleteMany).not.toHaveBeenCalled();
  });

  it("removes the budget when the limit is zero", async () => {
    category.findFirst.mockResolvedValue({ id: "c1" } as never);
    await setBudgetAction({ categoryId: "c1", month: "2026-06-01", limit: 0 });
    expect(budget.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", categoryId: "c1", month: expect.any(Date) },
    });
    expect(budget.upsert).not.toHaveBeenCalled();
  });

  it("rejects a negative limit at the schema", async () => {
    const result = await setBudgetAction({ categoryId: "c1", month: "2026-06-01", limit: -5 });
    expect(result.ok).toBe(false);
    expect(category.findFirst).not.toHaveBeenCalled();
  });
});

describe("setBudgetAction with scope: forward", () => {
  beforeEach(() => {
    category.findFirst.mockResolvedValue({ id: "c1" } as never);
  });

  it("upserts the limit across the whole forward window", async () => {
    const result = await setBudgetAction({ categoryId: "c1", month: "2026-06-01", limit: 600, scope: "forward" });
    expect(result).toEqual({ ok: true });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(budget.upsert).toHaveBeenCalledTimes(24);
    const months = budget.upsert.mock.calls.map(([args]) =>
      (args.where.userId_categoryId_month!.month as Date).toISOString().slice(0, 10),
    );
    expect(months[0]).toBe("2026-06-01");
    expect(months[1]).toBe("2026-07-01");
    // The window crosses a year boundary rather than wrapping inside 2026.
    expect(months[7]).toBe("2027-01-01");
    expect(months[23]).toBe("2028-05-01");
  });

  it("writes only the limit, leaving rollover alone", async () => {
    await setBudgetAction({ categoryId: "c1", month: "2026-06-01", limit: 600, scope: "forward" });
    for (const [args] of budget.upsert.mock.calls) {
      expect(args.update).toEqual({ limit: 600 });
      expect(args.create).not.toHaveProperty("rollover");
    }
  });

  it("clears the whole span when the limit is zero", async () => {
    await setBudgetAction({ categoryId: "c1", month: "2026-06-01", limit: 0, scope: "forward" });
    expect(budget.upsert).not.toHaveBeenCalled();
    const where = budget.deleteMany.mock.calls[0][0]!.where!;
    expect(where.userId).toBe("u1");
    expect(where.categoryId).toBe("c1");
    expect((where.month as { in: Date[] }).in).toHaveLength(24);
  });

  it("defaults to the viewed month only when no scope is given", async () => {
    await setBudgetAction({ categoryId: "c1", month: "2026-06-01", limit: 600 });
    expect(budget.upsert).toHaveBeenCalledOnce();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("still checks category ownership before writing forward", async () => {
    category.findFirst.mockResolvedValue(null);
    const result = await setBudgetAction({ categoryId: "c1", month: "2026-06-01", limit: 600, scope: "forward" });
    expect(result).toEqual({ ok: false, error: "Category not found" });
    expect(budget.upsert).not.toHaveBeenCalled();
    expect(budget.deleteMany).not.toHaveBeenCalled();
  });
});

describe("copyBudgetsAction", () => {
  it("errors when the source month has no budgets", async () => {
    budget.findMany.mockResolvedValue([]);
    const result = await copyBudgetsAction({ fromMonth: "2026-05-01", toMonth: "2026-06-01" });
    expect(result).toEqual({ ok: false, error: "No budgets in that month to copy." });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("upserts each source budget into the target month", async () => {
    budget.findMany.mockResolvedValue([
      { categoryId: "c1", limit: "100.00" },
      { categoryId: "c2", limit: "200.00" },
    ] as never);
    const result = await copyBudgetsAction({ fromMonth: "2026-05-01", toMonth: "2026-06-01" });
    expect(result).toEqual({ ok: true });
    // One upsert call queued per source budget, batched into $transaction.
    expect(budget.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const copiedCategories = budget.upsert.mock.calls.map(
      (c) => c[0].where.userId_categoryId_month?.categoryId,
    );
    expect(copiedCategories).toEqual(["c1", "c2"]);
  });
});
