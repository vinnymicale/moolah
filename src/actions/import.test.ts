// Action-layer tests for import.ts. analyzeImportAction carries the most logic:
// multiset duplicate detection against existing transactions, matching against
// projected recurring occurrences, and category suggestion priority (user rules
// beat the keyword guesser). commitImportAction's demo guard and category
// ownership filter are also covered. DB and helpers are stubbed.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));

vi.mock("@/lib/plaid-sync", () => ({ matchTransfers: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: vi.fn(), createMany: vi.fn() },
    recurringRule: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
    rule: { findMany: vi.fn() },
    financialAccount: { findFirst: vi.fn() },
  },
}));

import { analyzeImportAction, commitImportAction } from "./import";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

const requireUserMock = vi.mocked(requireUser);

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  requireUserMock.mockResolvedValue({ userId: "u1" } as Awaited<ReturnType<typeof requireUser>>);
  // Default: no existing data of any kind.
  vi.mocked(prisma.transaction.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.recurringRule.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.category.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.rule.findMany).mockResolvedValue([] as never);
});

describe("analyzeImportAction", () => {
  it("returns an empty result for no rows without touching the DB", async () => {
    const res = await analyzeImportAction([]);
    expect(res).toEqual({ ok: true, rows: [] });
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
  });

  it("flags a row that matches an existing transaction (same type/day/amount)", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { type: "EXPENSE", date: new Date("2026-01-10T00:00:00Z"), amount: "25.00" },
    ] as never);

    const res = await analyzeImportAction([
      { date: "2026-01-10", description: "Coffee", amount: 25, type: "EXPENSE" },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows[0].duplicate).toBe(true);
    expect(res.rows[0].duplicateReason).toBe("Already recorded");
  });

  it("only flags as many rows as there are existing matches (multiset)", async () => {
    // One existing $25 expense, two identical CSV rows -> first is a dup, second isn't.
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { type: "EXPENSE", date: new Date("2026-01-10T00:00:00Z"), amount: "25.00" },
    ] as never);

    const res = await analyzeImportAction([
      { date: "2026-01-10", description: "Coffee", amount: 25, type: "EXPENSE" },
      { date: "2026-01-10", description: "Coffee", amount: 25, type: "EXPENSE" },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => r.duplicate)).toEqual([true, false]);
  });

  it("flags a row that matches a projected recurring occurrence", async () => {
    vi.mocked(prisma.recurringRule.findMany).mockResolvedValue([
      {
        type: "EXPENSE",
        amount: "15.99",
        frequency: "MONTHLY",
        interval: 1,
        startDate: new Date("2026-01-05T00:00:00Z"),
        endDate: null,
        dayOfMonth: 5,
        weekday: null,
        archived: false,
      },
    ] as never);

    const res = await analyzeImportAction([
      { date: "2026-01-05", description: "Netflix", amount: 15.99, type: "EXPENSE" },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows[0].duplicate).toBe(true);
    expect(res.rows[0].duplicateReason).toBe("Matches a recurring rule");
  });

  it("prefers a user rule over the keyword guesser", async () => {
    vi.mocked(prisma.category.findMany).mockResolvedValue([
      { id: "cat-rules", name: "Subscriptions", kind: "EXPENSE" },
    ] as never);
    vi.mocked(prisma.rule.findMany).mockResolvedValue([
      {
        id: "r1",
        priority: 0,
        enabled: true,
        conditions: [{ type: "descriptionContains", value: "netflix" }],
        actions: [{ type: "setCategory", categoryId: "cat-rules" }],
      },
    ] as never);

    const res = await analyzeImportAction([
      { date: "2026-01-05", description: "NETFLIX.COM", amount: 15.99, type: "EXPENSE" },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows[0].suggestedCategoryId).toBe("cat-rules");
  });

  it("leaves suggestedCategoryId null when nothing matches", async () => {
    const res = await analyzeImportAction([
      { date: "2026-01-05", description: "zzz unknown vendor", amount: 3, type: "EXPENSE" },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows[0].suggestedCategoryId).toBeNull();
    expect(res.rows[0].duplicate).toBe(false);
  });

  it("returns a validation error for a malformed row", async () => {
    const res = await analyzeImportAction([
      { date: "01/05/2026", description: "Bad date", amount: 3, type: "EXPENSE" } as never,
    ]);
    expect(res.ok).toBe(false);
  });
});

describe("commitImportAction", () => {
  it("is a no-op success in demo mode", async () => {
    demoMode.value = true;
    const res = await commitImportAction({
      rows: [{ date: "2026-01-01", description: "x", amount: 1, type: "EXPENSE" }],
    });
    expect(res).toEqual({ ok: true });
    expect(prisma.transaction.createMany).not.toHaveBeenCalled();
  });

  it("fails when the target account isn't the user's", async () => {
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue(null as never);
    const res = await commitImportAction({
      accountId: "not-mine",
      rows: [{ date: "2026-01-01", description: "x", amount: 1, type: "EXPENSE" }],
    });
    expect(res).toEqual({ ok: false, error: "Account not found" });
    expect(prisma.transaction.createMany).not.toHaveBeenCalled();
  });

  it("drops category ids the user doesn't own, keeps valid ones", async () => {
    vi.mocked(prisma.category.findMany).mockResolvedValue([{ id: "mine" }] as never);
    vi.mocked(prisma.transaction.createMany).mockResolvedValue({ count: 2 } as never);

    const res = await commitImportAction({
      rows: [
        { date: "2026-01-01", description: "a", amount: 1, type: "EXPENSE", categoryId: "mine" },
        { date: "2026-01-02", description: "b", amount: 2, type: "EXPENSE", categoryId: "stolen" },
      ],
    });
    expect(res).toEqual({ ok: true });
    const arg = vi.mocked(prisma.transaction.createMany).mock.calls[0][0] as {
      data: { categoryId: string | null }[];
    };
    expect(arg.data[0].categoryId).toBe("mine");
    expect(arg.data[1].categoryId).toBeNull();
  });
});
