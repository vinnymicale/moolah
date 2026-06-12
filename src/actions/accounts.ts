"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { parseISODay } from "@/lib/dates";
import { run, UserError, type ActionResult } from "@/lib/action-result";
import { isDemoMode } from "@/lib/demo-guard";
import { AccountType } from "@/generated/prisma/enums";

const LIABILITY_TYPES: AccountType[] = ["CREDIT_CARD", "LOAN", "OTHER_LIABILITY"];

const accountSchema = z.object({
  name: z.string().min(1, "Name is required").max(80),
  type: z.enum(AccountType),
  institution: z.string().max(80).optional().nullable(),
  currentBalance: z.coerce.number().finite(),
  includeInCash: z.boolean().optional().default(false),
  includeInNetWorth: z.boolean().optional().default(true),
  includeInDebtPlanner: z.boolean().optional().default(true),
  color: z.string().max(20).optional(),
  // Debt-only - sent for liability accounts to power the payoff planner.
  interestRate: z.coerce.number().min(0).max(100).optional().nullable(),
  minimumPayment: z.coerce.number().min(0).finite().optional().nullable(),
});

export type AccountInput = z.input<typeof accountSchema>;

function isAssetType(type: AccountType): boolean {
  return !LIABILITY_TYPES.includes(type);
}

/** Debt fields apply only to liabilities; nulled/defaulted for assets. */
function debtFields(type: AccountType, data: z.infer<typeof accountSchema>) {
  if (isAssetType(type)) return { interestRate: null, minimumPayment: null, includeInDebtPlanner: true };
  return {
    interestRate: data.interestRate ?? null,
    minimumPayment: data.minimumPayment ?? null,
    includeInDebtPlanner: data.includeInDebtPlanner ?? true,
  };
}

async function ownedAccount(id: string, userId: string) {
  const acct = await prisma.financialAccount.findFirst({ where: { id, userId } });
  if (!acct) throw new UserError("Account not found");
  return acct;
}

export async function createAccountAction(input: AccountInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const data = accountSchema.parse(input);
    await prisma.financialAccount.create({
      data: {
        userId,
        name: data.name,
        type: data.type,
        institution: data.institution || null,
        currentBalance: data.currentBalance,
        isAsset: isAssetType(data.type),
        includeInCash: data.includeInCash ?? false,
        includeInNetWorth: data.includeInNetWorth ?? true,
        color: data.color || "#64748b",
        ...debtFields(data.type, data),
      },
    });
    revalidatePath("/accounts");
    revalidatePath("/");
  });
}

export async function updateAccountAction(id: string, input: AccountInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    await ownedAccount(id, userId);
    const data = accountSchema.parse(input);
    await prisma.financialAccount.update({
      where: { id },
      data: {
        name: data.name,
        type: data.type,
        institution: data.institution || null,
        currentBalance: data.currentBalance,
        isAsset: isAssetType(data.type),
        includeInCash: data.includeInCash ?? false,
        includeInNetWorth: data.includeInNetWorth ?? true,
        color: data.color || "#64748b",
        ...debtFields(data.type, data),
      },
    });
    revalidatePath("/accounts");
    revalidatePath("/");
  });
}

const debtTermsSchema = z.object({
  interestRate: z.coerce.number().min(0).max(100),
  minimumPayment: z.coerce.number().min(0).finite(),
});

export type DebtTermsInput = z.input<typeof debtTermsSchema>;

/** Update only the payoff-planner terms (APR + minimum) for a liability. */
export async function updateDebtTermsAction(id: string, input: DebtTermsInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const acct = await ownedAccount(id, userId);
    if (isAssetType(acct.type)) throw new UserError("Only debt accounts have payoff terms.");
    const data = debtTermsSchema.parse(input);
    await prisma.financialAccount.update({
      where: { id },
      data: { interestRate: data.interestRate, minimumPayment: data.minimumPayment },
    });
    revalidatePath("/debt");
    revalidatePath("/accounts");
  });
}

export async function archiveAccountAction(id: string, archived = true): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    await ownedAccount(id, userId);
    await prisma.financialAccount.update({ where: { id }, data: { archived } });
    revalidatePath("/accounts");
  });
}

export async function deleteAccountAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    await ownedAccount(id, userId);
    await prisma.financialAccount.delete({ where: { id } });
    revalidatePath("/accounts");
    revalidatePath("/");
  });
}

const snapshotSchema = z.object({
  accountId: z.string().min(1),
  balance: z.coerce.number().finite(),
  date: z.string().min(1),
  note: z.string().max(200).optional().nullable(),
  setCurrent: z.boolean().optional().default(true),
});

export type SnapshotInput = z.input<typeof snapshotSchema>;

export async function addSnapshotAction(input: SnapshotInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const data = snapshotSchema.parse(input);
    await ownedAccount(data.accountId, userId);
    await prisma.accountSnapshot.create({
      data: {
        accountId: data.accountId,
        balance: data.balance,
        date: parseISODay(data.date),
        note: data.note || null,
      },
    });
    if (data.setCurrent ?? true) {
      await prisma.financialAccount.update({
        where: { id: data.accountId },
        data: { currentBalance: data.balance },
      });
    }
    revalidatePath("/accounts");
    revalidatePath("/trends");
    revalidatePath("/");
  });
}

export async function deleteSnapshotAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const snap = await prisma.accountSnapshot.findFirst({ where: { id, account: { userId } } });
    if (!snap) throw new UserError("Snapshot not found");
    await prisma.accountSnapshot.delete({ where: { id } });
    revalidatePath("/accounts");
    revalidatePath("/trends");
  });
}
