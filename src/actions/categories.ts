"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { run, type ActionResult } from "@/lib/action-result";
import { isDemoMode } from "@/lib/demo-guard";
import { CategoryKind } from "@/generated/prisma/enums";

const categorySchema = z.object({
  name: z.string().min(1, "Name is required").max(60),
  kind: z.enum(CategoryKind),
  color: z.string().max(20).optional(),
  icon: z.string().max(40).optional(),
  parentId: z.string().optional().nullable(),
});

export type CategoryInput = z.input<typeof categorySchema>;

export async function createCategoryAction(input: CategoryInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId } = await requireHousehold();
    const data = categorySchema.parse(input);
    await prisma.category.create({
      data: {
        householdId,
        name: data.name,
        kind: data.kind,
        color: data.color || "#64748b",
        icon: data.icon || "tag",
        parentId: data.parentId || null,
      },
    });
    revalidatePath("/categories");
  });
}

export async function updateCategoryAction(id: string, input: CategoryInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId } = await requireHousehold();
    const existing = await prisma.category.findFirst({ where: { id, householdId } });
    if (!existing) throw new Error("Category not found");
    const data = categorySchema.parse(input);
    await prisma.category.update({
      where: { id },
      data: {
        name: data.name,
        kind: data.kind,
        color: data.color || "#64748b",
        icon: data.icon || "tag",
        parentId: data.parentId || null,
      },
    });
    revalidatePath("/categories");
  });
}

export async function deleteCategoryAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId } = await requireHousehold();
    const existing = await prisma.category.findFirst({ where: { id, householdId } });
    if (!existing) throw new Error("Category not found");
    await prisma.category.delete({ where: { id } });
    revalidatePath("/categories");
    revalidatePath("/transactions");
  });
}
