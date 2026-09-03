// Tests for previewRulesAction's dry-run output. The interesting part is the
// before/after sample rows: counts alone can't tell the user whether a rule is
// matching the transactions they meant, so each changed field has to report the
// value the row currently holds alongside the one the rule would write.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));

vi.mock("@/lib/rules", () => ({
  evaluateRules: vi.fn(() => ({})),
  splitByRatio: vi.fn(() => []),
}));
vi.mock("@/lib/plaid-sync", () => ({ matchTransfers: vi.fn(async () => 0) }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    rule: { findMany: vi.fn() },
    tag: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
    transaction: { findMany: vi.fn() },
  },
}));

import { previewRulesAction } from "./rules";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { evaluateRules } from "@/lib/rules";

const rule = vi.mocked(prisma.rule);
const tag = vi.mocked(prisma.tag);
const category = vi.mocked(prisma.category);
const txn = vi.mocked(prisma.transaction);
const evaluate = vi.mocked(evaluateRules);

const ENABLED_RULE = { id: "r1", conditions: [], actions: [], matchAll: true };

function row(over: Record<string, unknown> = {}) {
  return {
    description: "WHOLEFDS #123",
    date: new Date("2026-05-04T00:00:00Z"),
    amount: 42.5,
    accountId: "a1",
    type: "EXPENSE",
    categoryId: null,
    isTransfer: false,
    category: null,
    tags: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  vi.mocked(requireUser).mockResolvedValue({ userId: "u1" } as never);
  rule.findMany.mockResolvedValue([ENABLED_RULE] as never);
  tag.findMany.mockResolvedValue([{ id: "t1", name: "reimbursable" }] as never);
  category.findMany.mockResolvedValue([
    { id: "c1", name: "Groceries" },
    { id: "c2", name: "Household" },
  ] as never);
  txn.findMany.mockResolvedValue([] as never);
  evaluate.mockReturnValue({});
});

describe("previewRulesAction", () => {
  it("writes nothing in demo mode and reports an empty preview", async () => {
    demoMode.value = true;
    const res = await previewRulesAction();
    expect(res).toMatchObject({ ok: true, samples: [], moreSamples: 0 });
    expect(txn.findMany).not.toHaveBeenCalled();
  });

  it("reports an empty preview when the user has no rules", async () => {
    rule.findMany.mockResolvedValue([] as never);
    const res = await previewRulesAction();
    expect(res).toMatchObject({ ok: true, wouldCategorize: 0, samples: [] });
  });

  it("resolves a category id to its name and shows an empty before", async () => {
    txn.findMany.mockResolvedValue([row()] as never);
    evaluate.mockReturnValue({ categoryId: "c1" });

    const res = await previewRulesAction();
    if (!res.ok) throw new Error(res.error);
    expect(res.wouldCategorize).toBe(1);
    expect(res.samples).toHaveLength(1);
    expect(res.samples[0]).toMatchObject({ description: "WHOLEFDS #123", date: "2026-05-04", amount: 42.5 });
    expect(res.samples[0].changes).toEqual([{ field: "Category", before: null, after: "Groceries" }]);
  });

  it("skips a row that already has a category, since the rule only fills empties", async () => {
    txn.findMany.mockResolvedValue([row({ categoryId: "c2", category: { name: "Household" } })] as never);
    evaluate.mockReturnValue({ categoryId: "c1" });

    const res = await previewRulesAction();
    if (!res.ok) throw new Error(res.error);
    expect(res.wouldCategorize).toBe(0);
    expect(res.samples).toEqual([]);
  });

  it("shows the old and new description on a rename", async () => {
    txn.findMany.mockResolvedValue([row()] as never);
    evaluate.mockReturnValue({ description: "Whole Foods" });

    const res = await previewRulesAction();
    if (!res.ok) throw new Error(res.error);
    expect(res.wouldRename).toBe(1);
    expect(res.samples[0].changes).toEqual([
      { field: "Description", before: "WHOLEFDS #123", after: "Whole Foods" },
    ]);
  });

  it("ignores a rename that would write back the same description", async () => {
    txn.findMany.mockResolvedValue([row()] as never);
    evaluate.mockReturnValue({ description: "WHOLEFDS #123" });

    const res = await previewRulesAction();
    if (!res.ok) throw new Error(res.error);
    expect(res.wouldRename).toBe(0);
    expect(res.samples).toEqual([]);
  });

  it("does not count a transfer mark on a row that is already a transfer", async () => {
    txn.findMany.mockResolvedValue([row({ isTransfer: true })] as never);
    evaluate.mockReturnValue({ markTransfer: true });

    const res = await previewRulesAction();
    if (!res.ok) throw new Error(res.error);
    expect(res.wouldMarkTransfer).toBe(0);
    expect(res.samples).toEqual([]);
  });

  it("normalizes split ratios into percentages", async () => {
    txn.findMany.mockResolvedValue([row()] as never);
    evaluate.mockReturnValue({
      splits: [
        { categoryId: "c1", ratio: 3 },
        { categoryId: "c2", ratio: 1 },
      ],
    });

    const res = await previewRulesAction();
    if (!res.ok) throw new Error(res.error);
    expect(res.wouldSplit).toBe(1);
    expect(res.samples[0].changes).toEqual([
      { field: "Split", before: null, after: "Groceries 75% / Household 25%" },
    ]);
  });

  it("shows the tag list before and after, and drops tags the row already has", async () => {
    txn.findMany.mockResolvedValue([row({ tags: [{ id: "t9", name: "work" }] })] as never);
    evaluate.mockReturnValue({ addTagIds: ["t1", "t9"] });

    const res = await previewRulesAction();
    if (!res.ok) throw new Error(res.error);
    expect(res.wouldTag).toBe(1);
    expect(res.samples[0].changes).toEqual([
      { field: "Tags", before: "work", after: "work, reimbursable" },
    ]);
  });

  it("ignores a tag id that no longer belongs to the user", async () => {
    txn.findMany.mockResolvedValue([row()] as never);
    evaluate.mockReturnValue({ addTagIds: ["gone"] });

    const res = await previewRulesAction();
    if (!res.ok) throw new Error(res.error);
    expect(res.wouldTag).toBe(0);
    expect(res.samples).toEqual([]);
  });

  it("lists several changes to one row as separate entries", async () => {
    txn.findMany.mockResolvedValue([row()] as never);
    evaluate.mockReturnValue({ categoryId: "c1", description: "Whole Foods", markTransfer: true });

    const res = await previewRulesAction();
    if (!res.ok) throw new Error(res.error);
    expect(res.samples).toHaveLength(1);
    expect(res.samples[0].changes.map((c) => c.field)).toEqual(["Category", "Description", "Transfer"]);
  });

  it("caps the sample list and counts the rest in moreSamples", async () => {
    txn.findMany.mockResolvedValue(Array.from({ length: 20 }, () => row()) as never);
    evaluate.mockReturnValue({ categoryId: "c1" });

    const res = await previewRulesAction();
    if (!res.ok) throw new Error(res.error);
    expect(res.wouldCategorize).toBe(20);
    expect(res.samples).toHaveLength(8);
    expect(res.moreSamples).toBe(12);
  });

  it("rejects an unauthenticated caller without querying", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("no session"));
    const res = await previewRulesAction();
    expect(res.ok).toBe(false);
    expect(txn.findMany).not.toHaveBeenCalled();
  });
});
