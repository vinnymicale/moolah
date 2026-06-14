// Tests for the net-worth snapshot layer:
//   - captureNetWorthSnapshot: one upsert per non-archived account, keyed on
//     (accountId, date) so a same-day re-run overwrites rather than stacks.
//   - getNetWorthHistory: the carry-forward walk that turns sparse daily
//     snapshots into a continuous assets/liabilities/net line, including
//     pre-window seeding and the includeInNetWorth / isAsset signing.
//
// Prisma is mocked; no real database is touched.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    financialAccount: { findMany: vi.fn() },
    accountSnapshot: { findMany: vi.fn(), upsert: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { captureNetWorthSnapshot, getNetWorthHistory } from "./snapshots";
import { parseISODay } from "./dates";

const acctFind = vi.mocked(prisma.financialAccount.findMany);
const snapFind = vi.mocked(prisma.accountSnapshot.findMany);
const snapUpsert = vi.mocked(prisma.accountSnapshot.upsert);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("captureNetWorthSnapshot", () => {
  it("upserts one snapshot per non-archived account, keyed on (accountId, date)", async () => {
    acctFind.mockResolvedValue([
      { id: "a1", currentBalance: 1000 },
      { id: "a2", currentBalance: 250 },
    ] as never);
    snapUpsert.mockResolvedValue({} as never);

    const res = await captureNetWorthSnapshot("u1", "2026-06-14");

    expect(res).toEqual({ captured: 2 });
    expect(snapUpsert).toHaveBeenCalledTimes(2);
    const first = snapUpsert.mock.calls[0][0] as {
      where: { accountId_date: { accountId: string; date: Date } };
      create: { balance: number };
      update: { balance: number };
    };
    expect(first.where.accountId_date.accountId).toBe("a1");
    expect(first.where.accountId_date.date).toEqual(parseISODay("2026-06-14"));
    expect(first.create.balance).toBe(1000);
    expect(first.update.balance).toBe(1000);

    // Only archived:false accounts are captured.
    expect(acctFind.mock.calls[0][0]).toMatchObject({
      where: { userId: "u1", archived: false },
    });
  });
});

describe("getNetWorthHistory", () => {
  it("returns empty when the user has no net-worth accounts", async () => {
    acctFind.mockResolvedValue([] as never);
    const res = await getNetWorthHistory("u1", 7, "2026-06-14");
    expect(res).toEqual([]);
    expect(snapFind).not.toHaveBeenCalled();
  });

  it("carries the last balance forward across days with no snapshot", async () => {
    acctFind.mockResolvedValue([{ id: "a1", isAsset: true }] as never);
    // A balance set on day 1, then changed on day 3; day 2 carries day 1's value.
    snapFind.mockResolvedValue([
      { accountId: "a1", date: parseISODay("2026-06-12"), balance: 100 },
      { accountId: "a1", date: parseISODay("2026-06-14"), balance: 300 },
    ] as never);

    const res = await getNetWorthHistory("u1", 3, "2026-06-14");

    expect(res.map((p) => [p.date, p.net])).toEqual([
      ["2026-06-12", 100],
      ["2026-06-13", 100], // carried forward
      ["2026-06-14", 300],
    ]);
  });

  it("seeds day one from a snapshot taken before the window", async () => {
    acctFind.mockResolvedValue([{ id: "a1", isAsset: true }] as never);
    snapFind.mockResolvedValue([
      { accountId: "a1", date: parseISODay("2026-06-01"), balance: 500 },
    ] as never);

    const res = await getNetWorthHistory("u1", 2, "2026-06-14");

    // Both window days reflect the pre-window balance.
    expect(res).toEqual([
      { date: "2026-06-13", assets: 500, liabilities: 0, net: 500 },
      { date: "2026-06-14", assets: 500, liabilities: 0, net: 500 },
    ]);
  });

  it("signs liabilities negative against net and splits asset/liability totals", async () => {
    acctFind.mockResolvedValue([
      { id: "asset", isAsset: true },
      { id: "debt", isAsset: false },
    ] as never);
    snapFind.mockResolvedValue([
      { accountId: "asset", date: parseISODay("2026-06-14"), balance: 1000 },
      { accountId: "debt", date: parseISODay("2026-06-14"), balance: 400 },
    ] as never);

    const res = await getNetWorthHistory("u1", 1, "2026-06-14");

    expect(res).toEqual([{ date: "2026-06-14", assets: 1000, liabilities: 400, net: 600 }]);
  });

  it("only queries snapshots for includeInNetWorth, non-archived accounts", async () => {
    acctFind.mockResolvedValue([{ id: "a1", isAsset: true }] as never);
    snapFind.mockResolvedValue([] as never);

    await getNetWorthHistory("u1", 1, "2026-06-14");

    expect(acctFind.mock.calls[0][0]).toMatchObject({
      where: { userId: "u1", includeInNetWorth: true, archived: false },
    });
  });
});
