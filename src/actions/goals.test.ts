// Action-layer tests for goals.ts. These cover the guards that wrap the DB
// writes - the demo-mode short-circuit, ownership/existence checks, schema
// validation, and the contribution arithmetic (signed delta, clamped >= 0) -
// by stubbing the side-effecting imports (prisma, session, cache).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    savingsGoal: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import {
  createGoalAction,
  updateGoalAction,
  contributeGoalAction,
  deleteGoalAction,
} from "./goals";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

const requireUserMock = vi.mocked(requireUser);
const goal = vi.mocked(prisma.savingsGoal);

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  requireUserMock.mockResolvedValue({ userId: "u1" } as Awaited<ReturnType<typeof requireUser>>);
});

describe("demo-mode guard", () => {
  beforeEach(() => {
    demoMode.value = true;
  });

  it("createGoalAction is a no-op success in demo mode", async () => {
    const result = await createGoalAction({ name: "Trip", targetAmount: 1000 });
    expect(result).toEqual({ ok: true });
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(goal.create).not.toHaveBeenCalled();
  });

  it("updateGoalAction is a no-op success in demo mode", async () => {
    expect(await updateGoalAction("g1", { name: "Trip", targetAmount: 1000 })).toEqual({ ok: true });
    expect(goal.update).not.toHaveBeenCalled();
  });

  it("contributeGoalAction is a no-op success in demo mode", async () => {
    expect(await contributeGoalAction("g1", 50)).toEqual({ ok: true });
    expect(goal.update).not.toHaveBeenCalled();
  });

  it("deleteGoalAction is a no-op success in demo mode", async () => {
    expect(await deleteGoalAction("g1")).toEqual({ ok: true });
    expect(goal.delete).not.toHaveBeenCalled();
  });
});

describe("createGoalAction", () => {
  it("creates a goal with defaults filled in", async () => {
    const result = await createGoalAction({ name: "Emergency", targetAmount: 5000 });
    expect(result).toEqual({ ok: true });
    expect(goal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        name: "Emergency",
        targetAmount: 5000,
        currentAmount: 0,
        targetDate: null,
        color: "#16a34a",
        icon: "piggy-bank",
      }),
    });
  });

  it("parses a targetDate string into a Date", async () => {
    await createGoalAction({ name: "Trip", targetAmount: 1000, targetDate: "2026-12-01" });
    const data = goal.create.mock.calls[0][0].data;
    expect(data.targetDate).toBeInstanceOf(Date);
  });

  it("rejects a non-positive target amount", async () => {
    const result = await createGoalAction({ name: "Trip", targetAmount: 0 });
    expect(result).toEqual({ ok: false, error: "Target must be greater than zero" });
    expect(goal.create).not.toHaveBeenCalled();
  });

  it("rejects an empty name", async () => {
    const result = await createGoalAction({ name: "", targetAmount: 100 });
    expect(result).toEqual({ ok: false, error: "Name is required" });
    expect(goal.create).not.toHaveBeenCalled();
  });
});

describe("updateGoalAction", () => {
  it("errors when the goal does not belong to the user", async () => {
    goal.findFirst.mockResolvedValue(null);
    const result = await updateGoalAction("g1", { name: "Trip", targetAmount: 100 });
    expect(result).toEqual({ ok: false, error: "Goal not found" });
    expect(goal.findFirst).toHaveBeenCalledWith({ where: { id: "g1", userId: "u1" } });
    expect(goal.update).not.toHaveBeenCalled();
  });

  it("preserves the existing currentAmount when none is supplied", async () => {
    goal.findFirst.mockResolvedValue({
      id: "g1",
      currentAmount: "250.00",
      color: "#abc",
      icon: "star",
    } as never);
    await updateGoalAction("g1", { name: "Trip", targetAmount: 1000 });
    const data = goal.update.mock.calls[0][0].data;
    expect(data.currentAmount).toBe(250);
  });
});

describe("contributeGoalAction", () => {
  beforeEach(() => {
    goal.findFirst.mockResolvedValue({ id: "g1", currentAmount: "100.00" } as never);
  });

  it("adds a positive delta to the current amount", async () => {
    const result = await contributeGoalAction("g1", 40);
    expect(result).toEqual({ ok: true });
    expect(goal.update).toHaveBeenCalledWith({ where: { id: "g1" }, data: { currentAmount: 140 } });
  });

  it("subtracts a negative delta", async () => {
    await contributeGoalAction("g1", -30);
    expect(goal.update).toHaveBeenCalledWith({ where: { id: "g1" }, data: { currentAmount: 70 } });
  });

  it("clamps the balance at zero on an over-withdrawal", async () => {
    await contributeGoalAction("g1", -500);
    expect(goal.update).toHaveBeenCalledWith({ where: { id: "g1" }, data: { currentAmount: 0 } });
  });

  it("errors when the goal does not belong to the user", async () => {
    goal.findFirst.mockResolvedValue(null);
    const result = await contributeGoalAction("g1", 40);
    expect(result).toEqual({ ok: false, error: "Goal not found" });
    expect(goal.update).not.toHaveBeenCalled();
  });

  it("rejects a non-finite delta", async () => {
    const result = await contributeGoalAction("g1", Infinity);
    expect(result.ok).toBe(false);
    expect(goal.update).not.toHaveBeenCalled();
  });
});

describe("deleteGoalAction", () => {
  it("deletes a goal the user owns", async () => {
    goal.findFirst.mockResolvedValue({ id: "g1" } as never);
    const result = await deleteGoalAction("g1");
    expect(result).toEqual({ ok: true });
    expect(goal.delete).toHaveBeenCalledWith({ where: { id: "g1" } });
  });

  it("errors when the goal does not belong to the user", async () => {
    goal.findFirst.mockResolvedValue(null);
    const result = await deleteGoalAction("g1");
    expect(result).toEqual({ ok: false, error: "Goal not found" });
    expect(goal.delete).not.toHaveBeenCalled();
  });
});
