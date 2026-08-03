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
    ytdContribution: { upsert: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  },
}));

import {
  saveRetirementPlanAction,
  completeWizardAction,
  createContributionAction,
  deleteContributionAction,
  createScheduleAction,
  deleteScheduleAction,
  updateScheduleAction,
  saveEmployerMatchAction,
  saveYtdContributionsAction,
  clearYtdContributionsAction,
} from "./retirement";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

const requireUserMock = vi.mocked(requireUser);
const plan = vi.mocked(prisma.retirementPlan);
const account = vi.mocked(prisma.financialAccount);
const contribution = vi.mocked(prisma.contribution);
const schedule = vi.mocked(prisma.contributionSchedule);
const match = vi.mocked(prisma.employerMatch);
const ytd = vi.mocked(prisma.ytdContribution);

const validPlan = {
  birthYear: 1990,
  targetRetirementAge: 65,
  expectedReturn: 7,
  inflationRate: 3,
  incomeReplacementRatio: 80,
  safeWithdrawalRate: 4,
  expectedSocialSecurityMonthly: 0,
  currentAnnualSalary: 100_000,
  salaryGrowthRate: 0,
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

  it("scopes the ownership check to the account id and the current user", async () => {
    await createContributionAction(validContribution);
    expect(account.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "a1", userId: "u1" } }),
    );
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

  it("stores a prior-year designation", async () => {
    await createContributionAction({ ...validContribution, taxYear: 2025 });
    expect(contribution.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ taxYear: 2025 }) }),
    );
  });

  it("stores no designation when the tax year matches the deposit year", async () => {
    await createContributionAction({ ...validContribution, taxYear: 2026 });
    expect(contribution.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ taxYear: null }) }),
    );
  });

  it("stores no designation when none is given", async () => {
    await createContributionAction(validContribution);
    expect(contribution.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ taxYear: null }) }),
    );
  });

  it("rejects a tax year more than one year before the deposit", async () => {
    const r = await createContributionAction({ ...validContribution, taxYear: 2024 });
    expect(r.ok).toBe(false);
    expect(contribution.create).not.toHaveBeenCalled();
  });

  it("rejects a tax year after the deposit year", async () => {
    const r = await createContributionAction({ ...validContribution, taxYear: 2027 });
    expect(r.ok).toBe(false);
    expect(contribution.create).not.toHaveBeenCalled();
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

  it("scopes the ownership check to the contribution id and the current user", async () => {
    contribution.findFirst.mockResolvedValue({ id: "c1", userId: "u1" } as never);
    await deleteContributionAction("c1");
    expect(contribution.findFirst).toHaveBeenCalledWith({ where: { id: "c1", userId: "u1" } });
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

describe("updateScheduleAction", () => {
  const validUpdate = {
    financialAccountId: "a1",
    basis: "PERCENT_OF_SALARY" as const,
    percentOfSalary: 6,
    source: "EMPLOYEE_PRETAX" as const,
    frequency: "BIWEEKLY" as const,
    interval: 1,
    startDate: "2026-01-01",
  };

  beforeEach(() => {
    schedule.findFirst.mockResolvedValue({ id: "s1", userId: "u1" } as never);
  });

  it("refuses to edit another user's schedule", async () => {
    schedule.findFirst.mockResolvedValue(null);
    const r = await updateScheduleAction("s1", validUpdate);
    expect(r).toEqual({ ok: false, error: "Schedule not found" });
    expect(schedule.update).not.toHaveBeenCalled();
  });

  it("clears the dollar amount when switching to a percent basis", async () => {
    const r = await updateScheduleAction("s1", validUpdate);
    expect(r).toEqual({ ok: true });
    expect(schedule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "s1" },
        data: expect.objectContaining({ amount: null, percentOfSalary: 6 }),
      }),
    );
  });

  it("clears the percent when switching back to dollars", async () => {
    const r = await updateScheduleAction("s1", {
      ...validUpdate,
      basis: "AMOUNT",
      percentOfSalary: null,
      amount: 500,
    });
    expect(r).toEqual({ ok: true });
    expect(schedule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 500, percentOfSalary: null }),
      }),
    );
  });

  it("rejects a percent basis with no percent given", async () => {
    const r = await updateScheduleAction("s1", { ...validUpdate, percentOfSalary: null });
    expect(r.ok).toBe(false);
    expect(schedule.update).not.toHaveBeenCalled();
  });

  it("short-circuits in demo mode without writing", async () => {
    demoMode.value = true;
    expect(await updateScheduleAction("s1", validUpdate)).toEqual({ ok: true });
    expect(schedule.update).not.toHaveBeenCalled();
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

  it("scopes the ownership check to the schedule id and the current user", async () => {
    schedule.findFirst.mockResolvedValue({ id: "s1", userId: "u1" } as never);
    await deleteScheduleAction("s1");
    expect(schedule.findFirst).toHaveBeenCalledWith({ where: { id: "s1", userId: "u1" } });
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

describe("saveYtdContributionsAction", () => {
  const valid = {
    financialAccountId: "a1",
    year: 2026,
    entries: [{ source: "EMPLOYEE_PRETAX" as const, amount: 18_000 }],
  };

  it("upserts a positive total", async () => {
    const r = await saveYtdContributionsAction(valid);
    expect(r).toEqual({ ok: true });
    expect(ytd.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_year_financialAccountId_source: {
            userId: "u1",
            year: 2026,
            financialAccountId: "a1",
            source: "EMPLOYEE_PRETAX",
          },
        },
      }),
    );
  });

  it("deletes rather than stores a zero total", async () => {
    const r = await saveYtdContributionsAction({
      ...valid,
      entries: [{ source: "EMPLOYEE_ROTH", amount: 0 }],
    });
    expect(r).toEqual({ ok: true });
    expect(ytd.upsert).not.toHaveBeenCalled();
    expect(ytd.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", year: 2026, financialAccountId: "a1", source: "EMPLOYEE_ROTH" },
    });
  });

  it("rejects an account the user does not own", async () => {
    account.findFirst.mockResolvedValue(null as never);
    const r = await saveYtdContributionsAction(valid);
    expect(r.ok).toBe(false);
    expect(ytd.upsert).not.toHaveBeenCalled();
  });

  it("rejects a negative total", async () => {
    const r = await saveYtdContributionsAction({
      ...valid,
      entries: [{ source: "EMPLOYEE_PRETAX", amount: -5 }],
    });
    expect(r.ok).toBe(false);
    expect(ytd.upsert).not.toHaveBeenCalled();
  });

  it("short-circuits in demo mode", async () => {
    demoMode.value = true;
    expect(await saveYtdContributionsAction(valid)).toEqual({ ok: true });
    expect(ytd.upsert).not.toHaveBeenCalled();
  });
});

describe("clearYtdContributionsAction", () => {
  it("deletes every total for the year, scoped to the current user", async () => {
    const r = await clearYtdContributionsAction(2026);
    expect(r).toEqual({ ok: true });
    expect(ytd.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", year: 2026 } });
  });

  it("short-circuits in demo mode", async () => {
    demoMode.value = true;
    expect(await clearYtdContributionsAction(2026)).toEqual({ ok: true });
    expect(ytd.deleteMany).not.toHaveBeenCalled();
  });
});
