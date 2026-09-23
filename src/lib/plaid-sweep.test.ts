import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { syncPlaidItem } from "@/lib/plaid-sync";
import { FAILURE_BACKOFF_THRESHOLD, findDueItems, syncItems, sweepPlaid } from "./plaid-sweep";

vi.mock("@/lib/prisma", () => ({
  prisma: { plaidItem: { findMany: vi.fn(), update: vi.fn() } },
}));
vi.mock("@/lib/plaid-sync", () => ({ syncPlaidItem: vi.fn() }));

const NOW = new Date("2026-09-02T12:00:00Z");

function whereOf(call: number) {
  return vi.mocked(prisma.plaidItem.findMany).mock.calls[call][0]!.where as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.plaidItem.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.plaidItem.update).mockResolvedValue({} as never);
});

describe("findDueItems", () => {
  it("scopes to one household when given a householdId", async () => {
    await findDueItems({ householdId: "h1", now: NOW });
    expect(whereOf(0).householdId).toBe("h1");
  });

  it("sweeps every household when no householdId is given", async () => {
    await findDueItems({ now: NOW });
    expect(whereOf(0)).not.toHaveProperty("householdId");
  });

  it("takes everything regardless of staleness when forced", async () => {
    await findDueItems({ householdId: "h1", force: true, now: NOW });
    expect(whereOf(0)).toEqual({ householdId: "h1" });
  });

  it("always includes never-synced items, and backs failing ones off further", async () => {
    await findDueItems({ now: NOW });
    const or = whereOf(0).OR as Record<string, { lt?: Date }>[];

    expect(or[0]).toEqual({ lastSyncedAt: null });

    const healthy = or[1].lastSyncedAt!.lt!;
    const failing = or[2].lastSyncedAt!.lt!;
    expect(or[1].failureCount).toEqual({ lt: FAILURE_BACKOFF_THRESHOLD });
    expect(or[2].failureCount).toEqual({ gte: FAILURE_BACKOFF_THRESHOLD });
    // A repeatedly-failing item must wait longer before it is retried.
    expect(failing.getTime()).toBeLessThan(healthy.getTime());
  });
});

describe("syncItems", () => {
  it("passes each item's own householdId through, not a shared one", async () => {
    vi.mocked(syncPlaidItem).mockResolvedValue({
      added: 1, modified: 0, removed: 0, balancesUpdated: 2,
    } as never);

    const totals = await syncItems([
      { id: "i1", householdId: "h1" },
      { id: "i2", householdId: "h2" },
    ]);

    expect(syncPlaidItem).toHaveBeenCalledWith("i1", "h1");
    expect(syncPlaidItem).toHaveBeenCalledWith("i2", "h2");
    expect(totals).toMatchObject({ synced: 2, failed: 0, added: 2, balancesUpdated: 4 });
  });

  it("continues past a failure and bumps failureCount on the bad item", async () => {
    vi.mocked(syncPlaidItem)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ added: 0, modified: 0, removed: 0, balancesUpdated: 0 } as never);

    const totals = await syncItems([
      { id: "i1", householdId: "h1" },
      { id: "i2", householdId: "h2" },
    ]);

    expect(totals).toMatchObject({ synced: 1, failed: 1 });
    expect(prisma.plaidItem.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: expect.objectContaining({ error: "boom", failureCount: { increment: 1 } }),
    });
  });

  it("survives the failure bookkeeping itself failing", async () => {
    vi.mocked(syncPlaidItem).mockRejectedValue(new Error("boom"));
    vi.mocked(prisma.plaidItem.update).mockRejectedValue(new Error("db down") as never);

    await expect(syncItems([{ id: "i1", householdId: "h1" }])).resolves.toMatchObject({ failed: 1 });
  });
});

describe("sweepPlaid", () => {
  it("syncs the items the query returned", async () => {
    vi.mocked(prisma.plaidItem.findMany).mockResolvedValue([
      { id: "i1", householdId: "h1" },
    ] as never);
    vi.mocked(syncPlaidItem).mockResolvedValue({
      added: 0, modified: 0, removed: 0, balancesUpdated: 0,
    } as never);

    await sweepPlaid({});
    expect(syncPlaidItem).toHaveBeenCalledWith("i1", "h1");
  });
});
