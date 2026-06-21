// Action-layer tests for recurring.ts. These cover the demo-mode short-circuit,
// ownership checks, the delete-with-occurrences branch, and the suggestion-key
// parsing + in-memory normalized matching in linkSuggestionToRuleAction - by
// stubbing prisma, session, and cache.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recurringRule: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import {
  createRecurringAction,
  deleteRecurringAction,
  linkSuggestionToRuleAction,
} from "./recurring";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

const requireUserMock = vi.mocked(requireUser);
const rule = vi.mocked(prisma.recurringRule);
const txn = vi.mocked(prisma.transaction);

const validInput = {
  type: "EXPENSE" as const,
  amount: 50,
  description: "Gym",
  frequency: "MONTHLY" as const,
  startDate: "2026-01-01",
};

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  requireUserMock.mockResolvedValue({ userId: "u1" } as Awaited<ReturnType<typeof requireUser>>);
});

describe("demo-mode guard", () => {
  beforeEach(() => {
    demoMode.value = true;
  });

  it("createRecurringAction is a no-op success in demo mode", async () => {
    expect(await createRecurringAction(validInput)).toEqual({ ok: true });
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(rule.create).not.toHaveBeenCalled();
  });

  it("deleteRecurringAction is a no-op success in demo mode", async () => {
    expect(await deleteRecurringAction("r1")).toEqual({ ok: true });
    expect(rule.delete).not.toHaveBeenCalled();
  });
});

describe("createRecurringAction", () => {
  it("creates a rule with empty optional fields normalized to null", async () => {
    const result = await createRecurringAction(validInput);
    expect(result).toEqual({ ok: true });
    expect(rule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        accountId: null,
        categoryId: null,
        note: null,
        endDate: null,
        interval: 1,
      }),
    });
  });

  it("rejects a non-positive amount", async () => {
    const result = await createRecurringAction({ ...validInput, amount: 0 });
    expect(result.ok).toBe(false);
    expect(rule.create).not.toHaveBeenCalled();
  });

  it("rejects a weekday out of range", async () => {
    const result = await createRecurringAction({ ...validInput, weekday: 9 });
    expect(result.ok).toBe(false);
    expect(rule.create).not.toHaveBeenCalled();
  });
});

describe("deleteRecurringAction", () => {
  beforeEach(() => {
    rule.findFirst.mockResolvedValue({ id: "r1" } as never);
  });

  it("deletes the rule but keeps its occurrences by default", async () => {
    const result = await deleteRecurringAction("r1");
    expect(result).toEqual({ ok: true });
    expect(txn.deleteMany).not.toHaveBeenCalled();
    expect(rule.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
  });

  it("deletes the occurrences when asked", async () => {
    await deleteRecurringAction("r1", true);
    expect(txn.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", recurringRuleId: "r1" } });
    expect(rule.delete).toHaveBeenCalled();
  });

  it("errors when the rule does not belong to the user", async () => {
    rule.findFirst.mockResolvedValue(null);
    const result = await deleteRecurringAction("r1");
    expect(result).toEqual({ ok: false, error: "Recurring rule not found" });
    expect(rule.delete).not.toHaveBeenCalled();
  });
});

describe("linkSuggestionToRuleAction", () => {
  beforeEach(() => {
    rule.findFirst.mockResolvedValue({ id: "r1" } as never);
  });

  it("links transactions whose normalized description matches the key", async () => {
    // normalizeDescription drops tokens with digits and short noise, so
    // "NETFLIX 4085" and "Netflix" both normalize to "netflix"; "NETFLIX.COM"
    // normalizes to "netflix com" and does not match the bare "netflix" key.
    txn.findMany.mockResolvedValue([
      { id: "t1", description: "NETFLIX 4085" },
      { id: "t2", description: "Netflix" },
      { id: "t3", description: "NETFLIX.COM" },
      { id: "t4", description: "Spotify" },
    ] as never);
    const result = await linkSuggestionToRuleAction("r1", "EXPENSE|netflix");
    expect(result).toEqual({ ok: true });
    expect(txn.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["t1", "t2"] }, userId: "u1" },
      data: { recurringRuleId: "r1" },
    });
  });

  it("skips the update when nothing matches", async () => {
    txn.findMany.mockResolvedValue([{ id: "t3", description: "Spotify" }] as never);
    const result = await linkSuggestionToRuleAction("r1", "EXPENSE|netflix");
    expect(result).toEqual({ ok: true });
    expect(txn.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a key with no pipe separator", async () => {
    const result = await linkSuggestionToRuleAction("r1", "EXPENSE-no-pipe");
    expect(result).toEqual({ ok: false, error: "Invalid suggestion" });
    expect(txn.findMany).not.toHaveBeenCalled();
  });

  it("rejects a key with an unknown type", async () => {
    const result = await linkSuggestionToRuleAction("r1", "TRANSFER|rent");
    expect(result).toEqual({ ok: false, error: "Invalid suggestion" });
  });

  it("rejects a key with an empty normalized description", async () => {
    const result = await linkSuggestionToRuleAction("r1", "EXPENSE|");
    expect(result).toEqual({ ok: false, error: "Invalid suggestion" });
  });

  it("errors when the rule does not belong to the user", async () => {
    rule.findFirst.mockResolvedValue(null);
    const result = await linkSuggestionToRuleAction("r1", "EXPENSE|netflix");
    expect(result).toEqual({ ok: false, error: "Recurring rule not found" });
  });
});
