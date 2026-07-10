import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getUpcoming } from "@/lib/calendar";
import { getBudgetMonth } from "@/lib/queries/budgets";
import type { TriggerContext } from "../types";
import { digest, latestSlot } from "./digest";

vi.mock("@/lib/prisma", () => ({
  prisma: { financialAccount: { findMany: vi.fn() } },
}));
vi.mock("@/lib/calendar", () => ({ getUpcoming: vi.fn() }));
vi.mock("@/lib/queries/budgets", () => ({ getBudgetMonth: vi.fn() }));

describe("latestSlot", () => {
  it("daily: same day when the hour has passed", () => {
    const slot = latestSlot(new Date(2026, 6, 9, 12, 30), "daily", 8, 1);
    expect([slot.getFullYear(), slot.getMonth(), slot.getDate(), slot.getHours()]).toEqual([2026, 6, 9, 8]);
  });

  it("daily: previous day when the hour hasn't arrived", () => {
    const slot = latestSlot(new Date(2026, 6, 9, 6, 0), "daily", 8, 1);
    expect(slot.getDate()).toBe(8);
    expect(slot.getHours()).toBe(8);
  });

  it("weekly: most recent requested weekday at the hour", () => {
    // 2026-07-09 is a Thursday; most recent Monday 08:00 is 2026-07-06.
    const slot = latestSlot(new Date(2026, 6, 9, 12, 0), "weekly", 8, 1);
    expect([slot.getMonth(), slot.getDate(), slot.getHours()]).toEqual([6, 6, 8]);
  });

  it("weekly: steps back a week when today is the weekday but before the hour", () => {
    // 2026-07-06 is a Monday.
    const slot = latestSlot(new Date(2026, 6, 6, 6, 0), "weekly", 8, 1);
    expect(slot.getDate()).toBe(29); // Monday 2026-06-29
  });
});

describe("digest trigger", () => {
  const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
    userId: "u1",
    params: { frequency: "daily", weekday: 1, hour: 8, days: 3 },
    todayISO: "2026-07-09",
    now: new Date(2026, 6, 9, 12, 0),
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.financialAccount.findMany).mockResolvedValue([] as never);
    vi.mocked(getUpcoming).mockResolvedValue([] as never);
    vi.mocked(getBudgetMonth).mockResolvedValue([] as never);
  });

  it("emits nothing when there is nothing to report", async () => {
    expect(await digest.evaluate(ctx())).toEqual([]);
  });

  it("emits one event keyed to the slot date with a summary variable", async () => {
    vi.mocked(getUpcoming).mockResolvedValue([
      { date: "2026-07-10", description: "Netflix", amount: 15.49, type: "EXPENSE", categoryId: null, recurring: true },
    ] as never);
    const events = await digest.evaluate(ctx());
    expect(events).toHaveLength(1);
    expect(events[0].dedupeKey).toBe("digest:daily:2026-07-09");
    expect(events[0].vars.summary).toContain("Netflix");
    expect(events[0].vars.summary).toContain("$15.49");
  });

  it("includes overdue cards and over-budget categories in the summary", async () => {
    vi.mocked(prisma.financialAccount.findMany).mockResolvedValue([
      { name: "Sapphire", nextPaymentDueDate: new Date("2026-07-01T00:00:00Z"), lastStatementBalance: 250, isOverdue: true },
    ] as never);
    vi.mocked(getBudgetMonth).mockResolvedValue([
      { categoryId: "c1", name: "Groceries", color: "#888", icon: "cart", limit: 500, actual: 512.5, rollover: false, carryover: 0, effectiveLimit: 500 },
    ] as never);
    const events = await digest.evaluate(ctx());
    expect(events[0].vars.summary).toContain("Sapphire");
    expect(events[0].vars.summary).toContain("OVERDUE");
    expect(events[0].vars.summary).toContain("Groceries");
  });
});
