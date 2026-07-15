"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
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

async function findOwnedTag(userId: string, id: string) {
  const tag = await prisma.tag.findFirst({ where: { id, userId } });
  if (!tag) throw new UserError("Tag not found");
  return tag;
}

async function assertNameFree(userId: string, name: string, excludeId?: string) {
  const clash = await prisma.tag.findFirst({
    where: {
      userId,
      name: { equals: name, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (clash) throw new UserError("A tag with that name already exists");
}

export async function createTagAction(input: {
  name: string;
  color?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (isDemoMode()) return { ok: true, id: "demo-tag" };
  try {
    const { userId } = await requireUser();
    const name = normalizeTagName(input.name);
    const color = colorSchema.parse(input.color ?? DEFAULT_TAG_COLOR);
    await assertNameFree(userId, name);
    const tag = await prisma.tag.create({ data: { userId, name, color }, select: { id: true } });
    revalidateTagPages();
    return { ok: true, id: tag.id };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

export async function renameTagAction(id: string, name: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    await findOwnedTag(userId, id);
    const normalized = normalizeTagName(name);
    await assertNameFree(userId, normalized, id);
    await prisma.tag.update({ where: { id }, data: { name: normalized } });
    revalidateTagPages();
  });
}

export async function setTagColorAction(id: string, color: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    await findOwnedTag(userId, id);
    await prisma.tag.update({ where: { id }, data: { color: colorSchema.parse(color) } });
    revalidateTagPages();
  });
}

export async function deleteTagAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    await findOwnedTag(userId, id);
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
    const { userId } = await requireUser();
    if (sourceId === targetId) throw new UserError("Pick two different tags");
    await findOwnedTag(userId, sourceId);
    await findOwnedTag(userId, targetId);

    const toRepoint = await prisma.transaction.findMany({
      where: { userId, tags: { some: { id: sourceId } }, NOT: { tags: { some: { id: targetId } } } },
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

    const rules = await prisma.rule.findMany({ where: { userId } });
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
