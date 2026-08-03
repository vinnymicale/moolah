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
  salaryGrowthRate: z.coerce.number().min(-10).max(20),
});

const contributionSchema = z.object({
  financialAccountId: z.string().min(1),
  date: z.string().min(1),
  amount: moneyInput.pipe(z.number().positive("Amount must be greater than zero")),
  source: sourceSchema,
  // Only meaningful when it differs from the deposit year; null means "use the
  // deposit year". Bounded to the deposit year or the one before it, since
  // that's the only backdating the IRS allows.
  taxYear: z.coerce.number().int().min(1900).max(CURRENT_YEAR + 1).optional().nullable(),
  transactionId: z.string().optional().nullable(),
  note: z.string().max(200).optional().nullable(),
});

// A schedule states its size either in dollars or as a percent of salary, never
// both. The percent basis exists because payroll deferrals are usually set as a
// percentage, and a rounded dollar equivalent reads back as slightly under the
// intended rate.
const scheduleSchema = z
  .object({
    financialAccountId: z.string().min(1),
    basis: z.enum(["AMOUNT", "PERCENT_OF_SALARY"]).default("AMOUNT"),
    amount: moneyInput.pipe(z.number().positive("Amount must be greater than zero")).optional().nullable(),
    percentOfSalary: z.coerce
      .number()
      .gt(0, "Percent must be greater than zero")
      .max(100, "Percent cannot exceed 100")
      .optional()
      .nullable(),
    source: sourceSchema,
    frequency: z.enum(["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "YEARLY"]),
    interval: z.coerce.number().int().min(1).max(52),
    startDate: z.string().min(1),
    endDate: z.string().optional().nullable(),
    dayOfMonth: z.coerce.number().int().min(1).max(31).optional().nullable(),
    weekday: z.coerce.number().int().min(0).max(6).optional().nullable(),
  })
  .refine((d) => (d.basis === "PERCENT_OF_SALARY" ? d.percentOfSalary != null : d.amount != null), {
    message: "Enter an amount for a dollar schedule, or a percent for a percent-of-salary one",
    path: ["amount"],
  });

// A zero amount clears the row rather than storing it, so "I contributed
// nothing to Roth this year" and "I haven't filled this in" stay the same state.
const ytdContributionSchema = z.object({
  financialAccountId: z.string().min(1),
  year: z.coerce.number().int().min(1900).max(CURRENT_YEAR + 1),
  entries: z
    .array(
      z.object({
        source: sourceSchema,
        amount: moneyInput.pipe(z.number().min(0)),
      }),
    )
    .min(1),
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
export type YtdContributionInput = z.input<typeof ytdContributionSchema>;

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
    const date = parseISODay(data.date);

    // Store the designation only when it actually differs from the deposit
    // year, so the fallback stays the single source of truth for the common case.
    const depositYear = date.getUTCFullYear();
    let taxYear: number | null = null;
    if (data.taxYear != null && data.taxYear !== depositYear) {
      if (data.taxYear !== depositYear - 1) {
        throw new UserError("A contribution can only count toward its deposit year or the one before it");
      }
      taxYear = data.taxYear;
    }

    await prisma.contribution.create({
      data: {
        userId,
        financialAccountId: data.financialAccountId,
        date,
        amount: data.amount,
        source: data.source,
        taxYear,
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
        basis: data.basis,
        amount: data.basis === "PERCENT_OF_SALARY" ? null : data.amount,
        percentOfSalary: data.basis === "PERCENT_OF_SALARY" ? data.percentOfSalary : null,
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

/**
 * Saves hand-entered YTD totals for one account and year, replacing whatever
 * was there for the sources in `entries`. Zero amounts delete their row so the
 * "any row exists" override check in computeContributionLimits stays honest.
 */
export async function saveYtdContributionsAction(
  input: YtdContributionInput,
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const data = ytdContributionSchema.parse(input);
    await assertOwnsAccount(userId, data.financialAccountId);

    const { financialAccountId, year } = data;
    await prisma.$transaction(
      data.entries.map(({ source, amount }) =>
        amount > 0
          ? prisma.ytdContribution.upsert({
              where: {
                userId_year_financialAccountId_source: {
                  userId,
                  year,
                  financialAccountId,
                  source,
                },
              },
              create: { userId, year, financialAccountId, source, amount },
              update: { amount },
            })
          : prisma.ytdContribution.deleteMany({
              where: { userId, year, financialAccountId, source },
            }),
      ),
    );
    revalidatePaths();
  });
}

/** Drops every YTD total for a year, handing the limit bars back to the contribution log. */
export async function clearYtdContributionsAction(year: number): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    await prisma.ytdContribution.deleteMany({ where: { userId, year } });
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
