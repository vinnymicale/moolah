"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { parseISODay } from "@/lib/dates";
import { toNumber } from "@/lib/money";
import { run, UserError, type ActionResult } from "@/lib/action-result";
import { isDemoMode } from "@/lib/demo-guard";

const goalSchema = z.object({
  name: z.string().min(1, "Name is required").max(80),
  targetAmount: z.coerce.number().positive("Target must be greater than zero"),
  currentAmount: z.coerce.number().min(0).optional().default(0),
  targetDate: z.string().optional().nullable(),
  color: z.string().max(20).optional(),
  icon: z.string().max(40).optional(),
});

export type GoalInput = z.input<typeof goalSchema>;

export async function createGoalAction(input: GoalInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId } = await requireHousehold();
    const data = goalSchema.parse(input);
    await prisma.savingsGoal.create({
      data: {
        householdId,
        name: data.name,
        targetAmount: data.targetAmount,
        currentAmount: data.currentAmount ?? 0,
        targetDate: data.targetDate ? parseISODay(data.targetDate) : null,
        color: data.color || "#16a34a",
        icon: data.icon || "piggy-bank",
      },
    });
    revalidatePaths();
  });
}

export async function updateGoalAction(id: string, input: GoalInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId } = await requireHousehold();
    const existing = await prisma.savingsGoal.findFirst({ where: { id, householdId } });
    if (!existing) throw new UserError("Goal not found");
    const data = goalSchema.parse(input);
    await prisma.savingsGoal.update({
      where: { id },
      data: {
        name: data.name,
        targetAmount: data.targetAmount,
        currentAmount: data.currentAmount ?? toNumber(existing.currentAmount),
        targetDate: data.targetDate ? parseISODay(data.targetDate) : null,
        color: data.color || existing.color,
        icon: data.icon || existing.icon,
      },
    });
    revalidatePaths();
  });
}

/** Add (or, with a negative delta, withdraw) money toward a goal. Clamped ≥ 0. */
export async function contributeGoalAction(id: string, delta: number): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId } = await requireHousehold();
    const goal = await prisma.savingsGoal.findFirst({ where: { id, householdId } });
    if (!goal) throw new UserError("Goal not found");
    const amount = z.coerce.number().finite().parse(delta);
    const next = Math.max(0, toNumber(goal.currentAmount) + amount);
    await prisma.savingsGoal.update({ where: { id }, data: { currentAmount: next } });
    revalidatePaths();
  });
}

export async function deleteGoalAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId } = await requireHousehold();
    const existing = await prisma.savingsGoal.findFirst({ where: { id, householdId } });
    if (!existing) throw new UserError("Goal not found");
    await prisma.savingsGoal.delete({ where: { id } });
    revalidatePaths();
  });
}

function revalidatePaths() {
  revalidatePath("/goals");
  revalidatePath("/");
}
