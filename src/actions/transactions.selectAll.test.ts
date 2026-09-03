// Covers matchingTransactionIdsAction, which resolves the transactions list's
// URL params into the full set of matching ids so a bulk action can reach rows
// past the loaded page. The point of interest is that the scope is resolved
// server-side and scoped to the caller, and that the id cap is reported rather
// than silently applied.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => false }));
vi.mock("@/lib/tags", () => ({ resolveTagIds: vi.fn() }));
vi.mock("@/lib/user-tz", () => ({ userTodayISO: vi.fn(async () => "2026-06-15") }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: vi.fn() },
    transactionSplit: { deleteMany: vi.fn() },
    financialAccount: { findFirst: vi.fn() },
    category: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { requireUser } from "@/lib/session";
import { userTodayISO } from "@/lib/user-tz";
import { prisma } from "@/lib/prisma";
import { matchingTransactionIdsAction } from "./transactions";
import { BULK_ID_LIMIT } from "@/app/(app)/transactions/transactions-utils";

const txn = vi.mocked(prisma.transaction);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue({ userId: "u1" } as never);
  vi.mocked(userTodayISO).mockResolvedValue("2026-06-15");
  txn.findMany.mockResolvedValue([] as never);
});

function idRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));
}

describe("matchingTransactionIdsAction", () => {
  it("returns every matching id, untruncated", async () => {
    txn.findMany.mockResolvedValue(idRows(3) as never);
    const res = await matchingTransactionIdsAction({ m: "2026-06" });
    expect(res).toEqual({ ids: ["t0", "t1", "t2"], total: 3, truncated: false });
  });

  it("scopes the query to the caller and the resolved month", async () => {
    await matchingTransactionIdsAction({ m: "2026-04" });
    const where = txn.findMany.mock.calls[0][0]!.where as { userId: string; date: { gte: Date; lte: Date } };
    expect(where.userId).toBe("u1");
    expect(where.date.gte.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(where.date.lte.toISOString().slice(0, 10)).toBe("2026-04-30");
  });

  it("selects only ids, never whole rows", async () => {
    await matchingTransactionIdsAction({ m: "2026-06" });
    expect(txn.findMany.mock.calls[0][0]!.select).toEqual({ id: true });
  });

  it("applies the filter params from the URL", async () => {
    await matchingTransactionIdsAction({ m: "2026-06", type: "EXPENSE", q: "coffee" });
    const where = JSON.stringify(txn.findMany.mock.calls[0][0]!.where);
    expect(where).toContain("EXPENSE");
    expect(where).toContain("coffee");
  });

  it("resolves a custom range from from/to", async () => {
    await matchingTransactionIdsAction({ range: "custom", from: "2026-01-10", to: "2026-02-20" });
    const where = txn.findMany.mock.calls[0][0]!.where as { date: { gte: Date; lte: Date } };
    expect(where.date.gte.toISOString().slice(0, 10)).toBe("2026-01-10");
    expect(where.date.lte.toISOString().slice(0, 10)).toBe("2026-02-20");
  });

  it("caps the id list and reports the real total", async () => {
    txn.findMany.mockResolvedValue(idRows(BULK_ID_LIMIT + 5) as never);
    const res = await matchingTransactionIdsAction({ range: "all" });
    expect(res.ids).toHaveLength(BULK_ID_LIMIT);
    expect(res.total).toBe(BULK_ID_LIMIT + 5);
    expect(res.truncated).toBe(true);
  });

  it("rejects an unauthenticated caller", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("Unauthorized"));
    await expect(matchingTransactionIdsAction({ m: "2026-06" })).rejects.toThrow("Unauthorized");
    expect(txn.findMany).not.toHaveBeenCalled();
  });
});
