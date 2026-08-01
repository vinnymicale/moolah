// Action-layer tests: demo-mode short-circuit, ownership checks, schema
// validation, and the wizard's completedAt handling, with side-effecting
// imports stubbed.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    retirementPlan: { upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    financialAccount: { findFirst: vi.fn() },
    contribution: { create: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
    contributionSchedule: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    employerMatch: { upsert: vi.fn() },
  },
}));

import {
  saveRetirementPlanAction,
  completeWizardAction,
  createContributionAction,
  deleteContributionAction,
  createScheduleAction,
  deleteScheduleAction,
  saveEmployerMatchAction,
} from "./retirement";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

const requireUserMock = vi.mocked(requireUser);
const plan = vi.mocked(prisma.retirementPlan);
const account = vi.mocked(prisma.financialAccount);
const contribution = vi.mocked(prisma.contribution);
const schedule = vi.mocked(prisma.contributionSchedule);
const match = vi.mocked(prisma.employerMatch);

const validPlan = {
  birthYear: 1990,
  targetRetirementAge: 65,
  expectedReturn: 7,
  inflationRate: 3,
  incomeReplacementRatio: 80,
  safeWithdrawalRate: 4,
  expectedSocialSecurityMonthly: 0,
  currentAnnualSalary: 100_000,
};

const validContribution = {
  financialAccountId: "a1",
  date: "2026-03-01",
  amount: 1_000,
  source: "EMPLOYEE_PRETAX" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  requireUserMock.mockResolvedValue({ userId: "u1" } as Awaited<ReturnType<typeof requireUser>>);
  account.findFirst.mockResolvedValue({ id: "a1", userId: "u1" } as never);
});

describe("demo-mode guard", () => {
  beforeEach(() => {
    demoMode.value = true;
  });

  it("short-circuits plan saves without writing", async () => {
    expect(await saveRetirementPlanAction(validPlan)).toEqual({ ok: true });
    expect(plan.upsert).not.toHaveBeenCalled();
  });

  it("short-circuits contribution creation without writing", async () => {
    expect(await createContributionAction(validContribution)).toEqual({ ok: true });
    expect(contribution.create).not.toHaveBeenCalled();
  });
});

describe("saveRetirementPlanAction", () => {
  it("upserts the plan for the current user", async () => {
    const r = await saveRetirementPlanAction(validPlan);
    expect(r).toEqual({ ok: true });
    expect(plan.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1" } }),
    );
  });

  it("rejects an implausible birth year", async () => {
    const r = await saveRetirementPlanAction({ ...validPlan, birthYear: 1200 });
    expect(r.ok).toBe(false);
  });

  it("rejects a retirement age below 30", async () => {
    const r = await saveRetirementPlanAction({ ...validPlan, targetRetirementAge: 12 });
    expect(r.ok).toBe(false);
  });

  it("rejects a negative salary", async () => {
    const r = await saveRetirementPlanAction({ ...validPlan, currentAnnualSalary: -1 });
    expect(r.ok).toBe(false);
  });

  it("does not set completedAt", async () => {
    await saveRetirementPlanAction(validPlan);
    const arg = plan.upsert.mock.calls[0][0] as { create: Record<string, unknown> };
    expect(arg.create.completedAt).toBeUndefined();
  });
});

describe("completeWizardAction", () => {
  it("stamps completedAt", async () => {
    const r = await completeWizardAction();
    expect(r).toEqual({ ok: true });
    const arg = plan.update.mock.calls[0][0] as { data: { completedAt: Date } };
    expect(arg.data.completedAt).toBeInstanceOf(Date);
  });
});

describe("createContributionAction", () => {
  it("creates a contribution owned by the user", async () => {
    const r = await createContributionAction(validContribution);
    expect(r).toEqual({ ok: true });
    expect(contribution.create).toHaveBeenCalled();
  });

  it("rejects an account the user does not own", async () => {
    account.findFirst.mockResolvedValue(null);
    const r = await createContributionAction(validContribution);
    expect(r).toEqual({ ok: false, error: "Account not found" });
    expect(contribution.create).not.toHaveBeenCalled();
  });

  it("rejects a zero amount", async () => {
    const r = await createContributionAction({ ...validContribution, amount: 0 });
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown source", async () => {
    const r = await createContributionAction({
      ...validContribution,
      source: "NOT_A_SOURCE" as never,
    });
    expect(r.ok).toBe(false);
  });
});

describe("deleteContributionAction", () => {
  it("refuses to delete another user's contribution", async () => {
    contribution.findFirst.mockResolvedValue(null);
    const r = await deleteContributionAction("c1");
    expect(r).toEqual({ ok: false, error: "Contribution not found" });
    expect(contribution.delete).not.toHaveBeenCalled();
  });

  it("deletes an owned contribution", async () => {
    contribution.findFirst.mockResolvedValue({ id: "c1", userId: "u1" } as never);
    const r = await deleteContributionAction("c1");
    expect(r).toEqual({ ok: true });
    expect(contribution.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });
});

describe("createScheduleAction", () => {
  it("creates a schedule owned by the user", async () => {
    const r = await createScheduleAction({
      financialAccountId: "a1",
      amount: 1_000,
      source: "EMPLOYEE_PRETAX",
      frequency: "MONTHLY",
      interval: 1,
      startDate: "2026-01-01",
      dayOfMonth: 1,
    });
    expect(r).toEqual({ ok: true });
    expect(schedule.create).toHaveBeenCalled();
  });

  it("rejects an interval below one", async () => {
    const r = await createScheduleAction({
      financialAccountId: "a1",
      amount: 1_000,
      source: "EMPLOYEE_PRETAX",
      frequency: "MONTHLY",
      interval: 0,
      startDate: "2026-01-01",
      dayOfMonth: 1,
    });
    expect(r.ok).toBe(false);
  });
});

describe("deleteScheduleAction", () => {
  it("refuses to archive another user's schedule", async () => {
    schedule.findFirst.mockResolvedValue(null);
    const r = await deleteScheduleAction("s1");
    expect(r).toEqual({ ok: false, error: "Schedule not found" });
    expect(schedule.update).not.toHaveBeenCalled();
  });

  it("archives an owned schedule", async () => {
    schedule.findFirst.mockResolvedValue({ id: "s1", userId: "u1" } as never);
    const r = await deleteScheduleAction("s1");
    expect(r).toEqual({ ok: true });
    expect(schedule.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { archived: true },
    });
  });
});

describe("saveEmployerMatchAction", () => {
  it("saves a valid tiered formula", async () => {
    const r = await saveEmployerMatchAction({
      financialAccountId: "a1",
      tiers: [{ matchPercent: 100, upToPercentOfSalary: 3 }],
      annualCap: null,
    });
    expect(r).toEqual({ ok: true });
    expect(match.upsert).toHaveBeenCalled();
  });

  it("rejects a tier covering zero percent of salary", async () => {
    const r = await saveEmployerMatchAction({
      financialAccountId: "a1",
      tiers: [{ matchPercent: 100, upToPercentOfSalary: 0 }],
      annualCap: null,
    });
    expect(r.ok).toBe(false);
    expect(match.upsert).not.toHaveBeenCalled();
  });
});
