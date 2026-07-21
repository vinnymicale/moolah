import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import * as recurrence from "@/lib/recurrence";
import type { TriggerContext } from "../types";
import { paycheckMissing } from "./paycheck-missing";

vi.mock("@/lib/prisma", () => ({
  prisma: { recurringRule: { findMany: vi.fn() }, transaction: { findFirst: vi.fn() } },
}));
vi.mock("@/lib/recurrence", () => ({ expandOccurrences: vi.fn() }));

const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
  userId: "u1", params: { graceDays: 3 }, todayISO: "2026-07-09",
  now: new Date("2026-07-09T12:00:00Z"), ...over,
});
beforeEach(() => vi.clearAllMocks());

describe("paycheck-missing", () => {
  const rule = { id: "r1", description: "Paycheck", frequency: "MONTHLY", interval: 1,
    startDate: new Date("2026-01-01"), endDate: null, dayOfMonth: 1, weekday: null };

  it("fires when an expected paycheck has not posted", async () => {
    vi.mocked(prisma.recurringRule.findMany).mockResolvedValue([rule] as never);
    vi.mocked(recurrence.expandOccurrences).mockReturnValue([new Date("2026-07-01")]);
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);
    const events = await paycheckMissing.evaluate(ctx());
    expect(events).toEqual([
      { dedupeKey: "paycheck-missing:r1:2026-07-01",
        vars: { name: "Paycheck", expected_date: "2026-07-01", days_late: "8" } },
    ]);
  });

  it("is silent when a matching deposit exists", async () => {
    vi.mocked(prisma.recurringRule.findMany).mockResolvedValue([rule] as never);
    vi.mocked(recurrence.expandOccurrences).mockReturnValue([new Date("2026-07-01")]);
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({ id: "t1" } as never);
    expect(await paycheckMissing.evaluate(ctx())).toEqual([]);
  });
});
