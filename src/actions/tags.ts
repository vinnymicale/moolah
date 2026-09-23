"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/household";
import { run, UserError, type ActionResult } from "@/lib/action-result";
import { isDemoMode } from "@/lib/demo-guard";
import { normalizeTagName, DEFAULT_TAG_COLOR } from "@/lib/tags";
import type { RuleAction } from "@/lib/rules";
import type { Prisma } from "@/generated/prisma/client";

const colorSchema = z.string().max(20);

function revalidateTagPages() {
  revalidatePath("/categories");
  revalidatePath("/transactions");
  revalidatePath("/");
}

async function findOwnedTag(householdId: string, id: string) {
  const tag = await prisma.tag.findFirst({ where: { id, householdId } });
  if (!tag) throw new UserError("Tag not found");
  return tag;
}

async function assertNameFree(householdId: string, name: string, excludeId?: string) {
  const clash = await prisma.tag.findFirst({
    where: {
      householdId,
      name: { equals: name, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (clash) throw new UserError("A tag with that name already exists");
}

export async function createTagAction(input: {
  name: string;
  color?: string;
}): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  try {
    if (isDemoMode()) return { ok: true, id: "demo-tag", name: normalizeTagName(input.name) };
    const { householdId } = await requireCapability("EDIT_TRANSACTIONS");
    const name = normalizeTagName(input.name);
    const color = colorSchema.parse(input.color ?? DEFAULT_TAG_COLOR);
    await assertNameFree(householdId, name);
    const tag = await prisma.tag.create({ data: { householdId, name, color }, select: { id: true } });
    revalidateTagPages();
    return { ok: true, id: tag.id, name };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

export async function renameTagAction(id: string, name: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId } = await requireCapability("EDIT_TRANSACTIONS");
    await findOwnedTag(householdId, id);
    const normalized = normalizeTagName(name);
    await assertNameFree(householdId, normalized, id);
    await prisma.tag.update({ where: { id }, data: { name: normalized } });
    revalidateTagPages();
  });
}

export async function setTagColorAction(id: string, color: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId } = await requireCapability("EDIT_TRANSACTIONS");
    await findOwnedTag(householdId, id);
    await prisma.tag.update({ where: { id }, data: { color: colorSchema.parse(color) } });
    revalidateTagPages();
  });
}

export async function deleteTagAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId } = await requireCapability("EDIT_TRANSACTIONS");
    await findOwnedTag(householdId, id);
    await prisma.tag.delete({ where: { id } });
    revalidateTagPages();
  });
}

/**
 * Merge source into target: re-point tagged transactions, rewrite rules that
 * add the source tag, then delete the source (the join rows cascade away).
 */
export async function mergeTagsAction(sourceId: string, targetId: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId } = await requireCapability("EDIT_TRANSACTIONS");
    if (sourceId === targetId) throw new UserError("Pick two different tags");
    await findOwnedTag(householdId, sourceId);
    await findOwnedTag(householdId, targetId);

    const toRepoint = await prisma.transaction.findMany({
      where: { householdId, tags: { some: { id: sourceId } }, NOT: { tags: { some: { id: targetId } } } },
      select: { id: true },
    });
    await prisma.$transaction([
      ...toRepoint.map((t) =>
        prisma.transaction.update({
          where: { id: t.id },
          data: { tags: { connect: { id: targetId } } },
        }),
      ),
      prisma.tag.delete({ where: { id: sourceId } }),
    ]);

    const rules = await prisma.rule.findMany({ where: { householdId } });
    for (const r of rules) {
      const actions = r.actions as unknown as RuleAction[];
      if (!actions.some((a) => a.type === "addTag" && a.tagId === sourceId)) continue;
      const seen = new Set<string>();
      const rewritten = actions
        .map((a) => (a.type === "addTag" && a.tagId === sourceId ? { type: "addTag" as const, tagId: targetId } : a))
        .filter((a) => {
          if (a.type !== "addTag") return true;
          if (seen.has(a.tagId)) return false;
          seen.add(a.tagId);
          return true;
        });
      await prisma.rule.update({
        where: { id: r.id },
        data: { actions: rewritten as unknown as Prisma.InputJsonValue },
      });
    }

    revalidateTagPages();
  });
}
