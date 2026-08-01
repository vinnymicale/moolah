"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { parseISODay } from "@/lib/dates";
import { moneyInput } from "@/lib/money";
import { matchTiersSchema } from "@/lib/retirement-types";
import { run, UserError, type ActionResult } from "@/lib/action-result";
import { isDemoMode } from "@/lib/demo-guard";

const CURRENT_YEAR = new Date().getUTCFullYear();

const sourceSchema = z.enum([
  "EMPLOYEE_PRETAX",
  "EMPLOYEE_ROTH",
  "EMPLOYER_MATCH",
  "AFTER_TAX",
  "ROLLOVER",
]);

const planSchema = z.object({
  birthYear: z.coerce.number().int().min(1900).max(CURRENT_YEAR),
  targetRetirementAge: z.coerce.number().int().min(30).max(100),
  expectedReturn: z.coerce.number().min(-20).max(30),
  inflationRate: z.coerce.number().min(0).max(20),
  incomeReplacementRatio: z.coerce.number().min(1).max(200),
  safeWithdrawalRate: z.coerce.number().min(0.5).max(20),
  expectedSocialSecurityMonthly: moneyInput.pipe(z.number().min(0)),
  currentAnnualSalary: moneyInput.pipe(z.number().min(0)),
});

const contributionSchema = z.object({
  financialAccountId: z.string().min(1),
  date: z.string().min(1),
  amount: moneyInput.pipe(z.number().positive("Amount must be greater than zero")),
  source: sourceSchema,
  transactionId: z.string().optional().nullable(),
  note: z.string().max(200).optional().nullable(),
});

const scheduleSchema = z.object({
  financialAccountId: z.string().min(1),
  amount: moneyInput.pipe(z.number().positive("Amount must be greater than zero")),
  source: sourceSchema,
  frequency: z.enum(["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "YEARLY"]),
  interval: z.coerce.number().int().min(1).max(52),
  startDate: z.string().min(1),
  endDate: z.string().optional().nullable(),
  dayOfMonth: z.coerce.number().int().min(1).max(31).optional().nullable(),
  weekday: z.coerce.number().int().min(0).max(6).optional().nullable(),
});

const employerMatchSchema = z.object({
  financialAccountId: z.string().min(1),
  tiers: matchTiersSchema.min(1, "Add at least one match tier"),
  annualCap: moneyInput.pipe(z.number().min(0)).optional().nullable(),
});

export type RetirementPlanInput = z.input<typeof planSchema>;
export type ContributionInput = z.input<typeof contributionSchema>;
export type ScheduleInput = z.input<typeof scheduleSchema>;
export type EmployerMatchInput = z.input<typeof employerMatchSchema>;

/** Throws unless the account exists and belongs to the user. */
async function assertOwnsAccount(userId: string, financialAccountId: string): Promise<void> {
  const found = await prisma.financialAccount.findFirst({
    where: { id: financialAccountId, userId },
    select: { id: true },
  });
  if (!found) throw new UserError("Account not found");
}

export async function saveRetirementPlanAction(
  input: RetirementPlanInput,
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const data = planSchema.parse(input);
    await prisma.retirementPlan.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    revalidatePaths();
  });
}

/** Marks the wizard finished, which is what switches /retirement from wizard to page. */
export async function completeWizardAction(): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    await prisma.retirementPlan.update({
      where: { userId },
      data: { completedAt: new Date() },
    });
    revalidatePaths();
  });
}

export async function createContributionAction(input: ContributionInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const data = contributionSchema.parse(input);
    await assertOwnsAccount(userId, data.financialAccountId);
    await prisma.contribution.create({
      data: {
        userId,
        financialAccountId: data.financialAccountId,
        date: parseISODay(data.date),
        amount: data.amount,
        source: data.source,
        transactionId: data.transactionId || null,
        note: data.note || null,
      },
    });
    revalidatePaths();
  });
}

export async function deleteContributionAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const existing = await prisma.contribution.findFirst({ where: { id, userId } });
    if (!existing) throw new UserError("Contribution not found");
    await prisma.contribution.delete({ where: { id } });
    revalidatePaths();
  });
}

export async function createScheduleAction(input: ScheduleInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const data = scheduleSchema.parse(input);
    await assertOwnsAccount(userId, data.financialAccountId);
    await prisma.contributionSchedule.create({
      data: {
        userId,
        financialAccountId: data.financialAccountId,
        amount: data.amount,
        source: data.source,
        frequency: data.frequency,
        interval: data.interval,
        startDate: parseISODay(data.startDate),
        endDate: data.endDate ? parseISODay(data.endDate) : null,
        dayOfMonth: data.dayOfMonth ?? null,
        weekday: data.weekday ?? null,
      },
    });
    revalidatePaths();
  });
}

/** Archives rather than deletes, so past contributions keep their schedule link. */
export async function deleteScheduleAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const existing = await prisma.contributionSchedule.findFirst({ where: { id, userId } });
    if (!existing) throw new UserError("Schedule not found");
    await prisma.contributionSchedule.update({ where: { id }, data: { archived: true } });
    revalidatePaths();
  });
}

export async function saveEmployerMatchAction(
  input: EmployerMatchInput,
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const data = employerMatchSchema.parse(input);
    await assertOwnsAccount(userId, data.financialAccountId);
    await prisma.employerMatch.upsert({
      where: { financialAccountId: data.financialAccountId },
      create: {
        userId,
        financialAccountId: data.financialAccountId,
        tiers: data.tiers,
        annualCap: data.annualCap ?? null,
      },
      update: { tiers: data.tiers, annualCap: data.annualCap ?? null },
    });
    revalidatePaths();
  });
}

function revalidatePaths() {
  revalidatePath("/retirement");
  revalidatePath("/networth");
  revalidatePath("/");
}
