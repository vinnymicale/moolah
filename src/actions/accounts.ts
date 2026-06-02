"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { parseISODay } from "@/lib/dates";
import { run, type ActionResult } from "@/lib/action-result";
import { AccountType } from "@/generated/prisma/enums";

const LIABILITY_TYPES: AccountType[] = ["CREDIT_CARD", "LOAN", "OTHER_LIABILITY"];

const accountSchema = z.object({
  name: z.string().min(1, "Name is required").max(80),
  type: z.enum(AccountType),
  institution: z.string().max(80).optional().nullable(),
  currentBalance: z.coerce.number().finite(),
  includeInCash: z.boolean().optional().default(false),
  color: z.string().max(20).optional(),
});

export type AccountInput = z.input<typeof accountSchema>;

function isAssetType(type: AccountType): boolean {
  return !LIABILITY_TYPES.includes(type);
}

async function ownedAccount(id: string, householdId: string) {
  const acct = await prisma.financialAccount.findFirst({ where: { id, householdId } });
  if (!acct) throw new Error("Account not found");
  return acct;
}

export async function createAccountAction(input: AccountInput): Promise<ActionResult> {
  return run(async () => {
    const { householdId } = await requireHousehold();
    const data = accountSchema.parse(input);
    await prisma.financialAccount.create({
      data: {
        householdId,
        name: data.name,
        type: data.type,
        institution: data.institution || null,
        currentBalance: data.currentBalance,
        isAsset: isAssetType(data.type),
        includeInCash: data.includeInCash ?? false,
        color: data.color || "#64748b",
      },
    });
    revalidatePath("/accounts");
    revalidatePath("/");
  });
}

export async function updateAccountAction(id: string, input: AccountInput): Promise<ActionResult> {
  return run(async () => {
    const { householdId } = await requireHousehold();
    await ownedAccount(id, householdId);
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
        color: data.color || "#64748b",
      },
    });
    revalidatePath("/accounts");
    revalidatePath("/");
  });
}

export async function archiveAccountAction(id: string, archived = true): Promise<ActionResult> {
  return run(async () => {
    const { householdId } = await requireHousehold();
    await ownedAccount(id, householdId);
    await prisma.financialAccount.update({ where: { id }, data: { archived } });
    revalidatePath("/accounts");
  });
}

export async function deleteAccountAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const { householdId } = await requireHousehold();
    await ownedAccount(id, householdId);
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
  return run(async () => {
    const { householdId } = await requireHousehold();
    const data = snapshotSchema.parse(input);
    await ownedAccount(data.accountId, householdId);
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
  return run(async () => {
    const { householdId } = await requireHousehold();
    const snap = await prisma.accountSnapshot.findFirst({ where: { id, account: { householdId } } });
    if (!snap) throw new Error("Snapshot not found");
    await prisma.accountSnapshot.delete({ where: { id } });
    revalidatePath("/accounts");
    revalidatePath("/trends");
  });
}
