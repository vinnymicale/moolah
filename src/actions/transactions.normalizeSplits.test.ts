// Focused tests for normalizeSplits - the action-layer guard that validates
// split parts and confirms every split category belongs to the user and matches
// the transaction kind. The cross-user / wrong-kind rejection is a security
// boundary (a malicious payload could otherwise attribute spend to a category
// the user doesn't own), so it's worth covering directly.

import { describe, it, expect, vi, beforeEach } from "vitest";

// The module is a "use server" file; stub its side-effecting imports so it loads
// in a plain test context. Only prisma.category.count is exercised here.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => false }));
vi.mock("@/lib/prisma", () => ({
  prisma: { category: { count: vi.fn() } },
}));

import { normalizeSplits } from "./transactions";
import { prisma } from "@/lib/prisma";

const count = vi.mocked(prisma.category.count);

beforeEach(() => {
  count.mockReset();
});

describe("normalizeSplits", () => {
  it("returns [] when fewer than two parts are given (means not split)", async () => {
    expect(await normalizeSplits("u1", "EXPENSE", 100, null)).toEqual([]);
    expect(await normalizeSplits("u1", "EXPENSE", 100, [{ categoryId: "a", amount: 100 }])).toEqual([]);
    expect(count).not.toHaveBeenCalled();
  });

  it("rejects parts that don't sum to the total (delegates to validateSplits)", async () => {
    await expect(
      normalizeSplits("u1", "EXPENSE", 100, [
        { categoryId: "a", amount: 40 },
        { categoryId: "b", amount: 40 },
      ]),
    ).rejects.toThrow(/add up/i);
    expect(count).not.toHaveBeenCalled();
  });

  it("accepts valid splits whose categories all belong to the user and kind", async () => {
    count.mockResolvedValue(2);
    const result = await normalizeSplits("u1", "EXPENSE", 100, [
      { categoryId: "a", amount: 60 },
      { categoryId: "b", amount: 40 },
    ]);
    expect(result).toEqual([
      { categoryId: "a", amount: 60 },
      { categoryId: "b", amount: 40 },
    ]);
    // Looked up exactly the named categories, scoped to user + kind.
    expect(count).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b"] }, userId: "u1", kind: "EXPENSE" },
    });
  });

  it("rejects a split category the user doesn't own (count short of expected)", async () => {
    count.mockResolvedValue(1); // only one of the two ids matched for this user
    await expect(
      normalizeSplits("u1", "EXPENSE", 100, [
        { categoryId: "mine", amount: 60 },
        { categoryId: "someone-elses", amount: 40 },
      ]),
    ).rejects.toThrow(/not found/i);
  });

  it("rejects a split category of the wrong kind (income cat on an expense)", async () => {
    count.mockResolvedValue(1); // the income-kind category is filtered out by kind: EXPENSE
    await expect(
      normalizeSplits("u1", "EXPENSE", 100, [
        { categoryId: "groceries", amount: 60 },
        { categoryId: "paycheck", amount: 40 },
      ]),
    ).rejects.toThrow(/not found/i);
  });

  it("normalizes empty-string categoryId to null and skips the ownership query when all parts are uncategorized", async () => {
    const result = await normalizeSplits("u1", "EXPENSE", 100, [
      { categoryId: "", amount: 60 },
      { categoryId: null, amount: 40 },
    ]);
    expect(result).toEqual([
      { categoryId: null, amount: 60 },
      { categoryId: null, amount: 40 },
    ]);
    // No named categories -> no DB round trip.
    expect(count).not.toHaveBeenCalled();
  });

  it("deduplicates named categories before counting (mixed named + uncategorized)", async () => {
    count.mockResolvedValue(1);
    await normalizeSplits("u1", "EXPENSE", 100, [
      { categoryId: "a", amount: 30 },
      { categoryId: "a", amount: 30 }, // dup would be rejected by validateSplits first
      { categoryId: null, amount: 40 },
    ]).catch(() => {});
    // validateSplits rejects the duplicate named category before any DB call.
    expect(count).not.toHaveBeenCalled();
  });
});
