import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { TriggerContext } from "../types";
import { duplicateCharge } from "./duplicate-charge";

vi.mock("@/lib/prisma", () => ({
  prisma: { transaction: { findMany: vi.fn(), findFirst: vi.fn() } },
}));

const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
  userId: "u1", params: { withinDays: 3 }, todayISO: "2026-07-09",
  now: new Date("2026-07-09T12:00:00Z"), ...over,
});
const syncEvent = (ids: string[]) => ({ kind: "plaid-sync" as const, newTransactionIds: ids });

beforeEach(() => vi.clearAllMocks());

describe("duplicate-charge", () => {
  it("fires when a matching earlier charge exists", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { id: "t2", description: "Spotify", amount: 9.99, date: new Date("2026-07-09"), account: { name: "Checking" } },
    ] as never);
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({ id: "t1", date: new Date("2026-07-08") } as never);
    const events = await duplicateCharge.evaluate(ctx({ event: syncEvent(["t2"]) }));
    expect(events).toEqual([
      { dedupeKey: "duplicate-charge:t2",
        vars: { merchant: "Spotify", amount: "$9.99", account: "Checking", days_apart: "1" } },
    ]);
  });

  it("is silent with no earlier match", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { id: "t2", description: "Spotify", amount: 9.99, date: new Date("2026-07-09"), account: { name: "Checking" } },
    ] as never);
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);
    expect(await duplicateCharge.evaluate(ctx({ event: syncEvent(["t2"]) }))).toEqual([]);
  });

  it("is silent without an event", async () => {
    expect(await duplicateCharge.evaluate(ctx())).toEqual([]);
  });
});
