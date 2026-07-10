import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { TriggerContext } from "../types";
import { plaidReauth } from "./plaid-reauth";
import { syncFailing } from "./sync-failing";
import { accountStale } from "./account-stale";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    plaidItem: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}));

const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
  userId: "u1",
  params: {},
  todayISO: "2026-07-09",
  now: new Date("2026-07-09T12:00:00Z"),
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("plaid-reauth", () => {
  it("fires per item needing reauth with a daily dedupe key", async () => {
    vi.mocked(prisma.plaidItem.findMany).mockResolvedValue([
      { id: "it1", institutionName: "Chase" },
    ] as never);
    const events = await plaidReauth.evaluate(ctx());
    expect(events).toEqual([
      { dedupeKey: "plaid-reauth:it1:2026-07-09", vars: { institution: "Chase" } },
    ]);
  });

  it("is silent when no item has a reauth error", async () => {
    vi.mocked(prisma.plaidItem.findMany).mockResolvedValue([] as never);
    expect(await plaidReauth.evaluate(ctx())).toEqual([]);
  });
});

describe("sync-failing", () => {
  const failEvent = (failureCount: number, reauthRequired = false) => ({
    kind: "plaid-sync-failed" as const,
    plaidItemId: "it1",
    reauthRequired,
    failureCount,
    newTransactionIds: [],
  });

  it("fires when the failure streak reaches the threshold", async () => {
    vi.mocked(prisma.plaidItem.findUnique).mockResolvedValue(
      { institutionName: "Chase", error: "RATE_LIMIT" } as never,
    );
    const events = await syncFailing.evaluate(ctx({ params: { failures: 3 }, event: failEvent(3) }));
    expect(events).toEqual([
      {
        dedupeKey: "sync-failing:it1:2026-07-09",
        vars: { institution: "Chase", failures: "3", error: "RATE_LIMIT" },
      },
    ]);
  });

  it("is silent below the threshold", async () => {
    expect(await syncFailing.evaluate(ctx({ params: { failures: 3 }, event: failEvent(2) }))).toEqual([]);
  });

  it("is silent for reauth failures (plaid-reauth owns those)", async () => {
    expect(await syncFailing.evaluate(ctx({ params: { failures: 1 }, event: failEvent(5, true) }))).toEqual([]);
  });

  it("is silent without an event payload", async () => {
    expect(await syncFailing.evaluate(ctx({ params: { failures: 3 } }))).toEqual([]);
  });
});

describe("account-stale", () => {
  it("fires when lastSyncedAt is older than the threshold", async () => {
    vi.mocked(prisma.plaidItem.findMany).mockResolvedValue([
      { id: "it1", institutionName: "Chase", lastSyncedAt: new Date("2026-07-04T12:00:00Z") },
    ] as never);
    const events = await accountStale.evaluate(ctx({ params: { days: 3 } }));
    expect(events).toEqual([
      { dedupeKey: "account-stale:it1:2026-07-09", vars: { institution: "Chase", days: "5" } },
    ]);
  });

  it("skips fresh items and never-synced items", async () => {
    vi.mocked(prisma.plaidItem.findMany).mockResolvedValue([
      { id: "it1", institutionName: "Chase", lastSyncedAt: new Date("2026-07-08T12:00:00Z") },
      { id: "it2", institutionName: "Ally", lastSyncedAt: null },
    ] as never);
    expect(await accountStale.evaluate(ctx({ params: { days: 3 } }))).toEqual([]);
  });
});
