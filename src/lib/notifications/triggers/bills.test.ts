import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getUpcoming } from "@/lib/calendar";
import type { TriggerContext } from "../types";
import { billDue } from "./bill-due";
import { ccDue } from "./cc-due";
import { recurringPriceChange } from "./recurring-price-change";
import { recurringMissing } from "./recurring-missing";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    financialAccount: { findMany: vi.fn() },
    recurringRule: { findMany: vi.fn() },
    transaction: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/calendar", () => ({ getUpcoming: vi.fn() }));

const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
  userId: "u1",
  params: {},
  todayISO: "2026-07-09",
  now: new Date("2026-07-09T12:00:00Z"),
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("bill-due", () => {
  it("fires for upcoming expense bills within the window", async () => {
    vi.mocked(getUpcoming).mockResolvedValue([
      { date: "2026-07-11", description: "Netflix", amount: 15.49, type: "EXPENSE", categoryId: null, recurring: true },
      { date: "2026-07-10", description: "Paycheck", amount: 2000, type: "INCOME", categoryId: null, recurring: true },
    ] as never);
    const events = await billDue.evaluate(ctx({ params: { days: 3 } }));
    expect(events).toEqual([
      {
        dedupeKey: "bill-due:Netflix:2026-07-11",
        vars: { name: "Netflix", amount: "$15.49", due_date: "2026-07-11", days: "2" },
      },
    ]);
    expect(getUpcoming).toHaveBeenCalledWith("u1", "2026-07-09", 3);
  });
});

describe("cc-due", () => {
  const card = (over: Record<string, unknown> = {}) => ({
    id: "a1", name: "Sapphire", nextPaymentDueDate: new Date("2026-07-11T00:00:00Z"),
    lastStatementBalance: 250, isOverdue: null, ...over,
  });

  it("fires for a statement due inside the window", async () => {
    vi.mocked(prisma.financialAccount.findMany).mockResolvedValue([card()] as never);
    const events = await ccDue.evaluate(ctx({ params: { days: 3 } }));
    expect(events).toEqual([
      {
        dedupeKey: "cc-due:a1:2026-07-11",
        vars: { account: "Sapphire", amount: "$250.00", due_date: "2026-07-11", days: "2" },
      },
    ]);
  });

  it("skips zero statements, non-overdue past dates, and dates beyond the window", async () => {
    vi.mocked(prisma.financialAccount.findMany).mockResolvedValue([
      card({ id: "a2", lastStatementBalance: 0 }),
      card({ id: "a3", nextPaymentDueDate: new Date("2026-07-01T00:00:00Z"), isOverdue: false }),
      card({ id: "a4", nextPaymentDueDate: new Date("2026-07-20T00:00:00Z") }),
    ] as never);
    expect(await ccDue.evaluate(ctx({ params: { days: 3 } }))).toEqual([]);
  });

  it("fires for an overdue card even past the due date", async () => {
    vi.mocked(prisma.financialAccount.findMany).mockResolvedValue([
      card({ nextPaymentDueDate: new Date("2026-07-01T00:00:00Z"), isOverdue: true }),
    ] as never);
    const events = await ccDue.evaluate(ctx({ params: { days: 3 } }));
    expect(events).toHaveLength(1);
    expect(events[0].vars.days).toBe("0");
  });
});

describe("recurring-price-change", () => {
  it("fires when a matched transaction differs from its rule by at least minPercent", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { id: "t1", amount: 18.99, recurringRule: { id: "r1", description: "Netflix", amount: 15.49 } },
    ] as never);
    const events = await recurringPriceChange.evaluate(
      ctx({ params: { minPercent: 10 }, event: { kind: "plaid-sync", newTransactionIds: ["t1"] } }),
    );
    expect(events).toEqual([
      {
        dedupeKey: "recurring-price-change:r1:t1",
        vars: { name: "Netflix", old_amount: "$15.49", new_amount: "$18.99", change: "+23%" },
      },
    ]);
  });

  it("is silent under the threshold and without an event", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { id: "t1", amount: 15.99, recurringRule: { id: "r1", description: "Netflix", amount: 15.49 } },
    ] as never);
    expect(
      await recurringPriceChange.evaluate(
        ctx({ params: { minPercent: 10 }, event: { kind: "plaid-sync", newTransactionIds: ["t1"] } }),
      ),
    ).toEqual([]);
    expect(await recurringPriceChange.evaluate(ctx({ params: { minPercent: 10 } }))).toEqual([]);
  });
});

describe("recurring-missing", () => {
  const rule = {
    id: "r1", description: "Netflix", frequency: "MONTHLY", interval: 1,
    startDate: new Date("2026-01-01T00:00:00Z"), endDate: null, dayOfMonth: 1, weekday: null,
  };

  it("fires when the last expected occurrence has no matching transaction past the grace period", async () => {
    vi.mocked(prisma.recurringRule.findMany).mockResolvedValue([rule] as never);
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);
    const events = await recurringMissing.evaluate(ctx({ params: { graceDays: 3 } }));
    expect(events).toEqual([
      {
        dedupeKey: "recurring-missing:r1:2026-07-01",
        vars: { name: "Netflix", expected_date: "2026-07-01", days_late: "8" },
      },
    ]);
  });

  it("is silent when a transaction matched the occurrence", async () => {
    vi.mocked(prisma.recurringRule.findMany).mockResolvedValue([rule] as never);
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({ id: "t1" } as never);
    expect(await recurringMissing.evaluate(ctx({ params: { graceDays: 3 } }))).toEqual([]);
  });
});
