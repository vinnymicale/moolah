"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { run, UserError, type ActionResult } from "@/lib/action-result";
import { isDemoMode } from "@/lib/demo-guard";
import { toCents } from "@/lib/money";
import { matchTransfers } from "@/lib/plaid-sync";
import {
  evaluateRules,
  splitByRatio,
  type RuleAction,
  type RuleCondition,
  type RuleLike,
  type TxnFacts,
} from "@/lib/rules";

// ── Validation ────────────────────────────────────────────────────────────────

const conditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("descriptionContains"), value: z.string().trim().min(1).max(80) }),
  z.object({
    type: z.literal("amountRange"),
    min: z.coerce.number().nonnegative().optional(),
    max: z.coerce.number().nonnegative().optional(),
  }),
  z.object({ type: z.literal("account"), accountId: z.string().min(1) }),
  z.object({ type: z.literal("type"), txnType: z.enum(["INCOME", "EXPENSE"]) }),
]);

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setCategory"), categoryId: z.string().min(1) }),
  z.object({ type: z.literal("rewriteDescription"), to: z.string().trim().min(1).max(120) }),
  z.object({ type: z.literal("markTransfer") }),
  z.object({
    type: z.literal("split"),
    parts: z
      .array(z.object({ categoryId: z.string().min(1), ratio: z.coerce.number().positive() }))
      .min(2, "A split needs at least two parts")
      .max(20),
  }),
  z.object({ type: z.literal("addTag"), tagId: z.string().min(1) }),
]);

const ruleSchema = z.object({
  name: z.string().trim().max(80).optional().nullable(),
  enabled: z.boolean().default(true),
  conditions: z.array(conditionSchema).min(1, "Add at least one condition").max(8),
  actions: z.array(actionSchema).min(1, "Add at least one action").max(8),
});

export type RuleInput = z.input<typeof ruleSchema>;

// Validate that every category/account referenced by the rule belongs to the
// user, so a rule can't smuggle in another user's ids via the JSON payload.
async function assertReferencesOwned(
  userId: string,
  conditions: RuleCondition[],
  actions: RuleAction[],
): Promise<void> {
  const categoryIds = new Set<string>();
  const accountIds = new Set<string>();
  const tagIds = new Set<string>();
  for (const c of conditions) if (c.type === "account") accountIds.add(c.accountId);
  for (const a of actions) {
    if (a.type === "setCategory") categoryIds.add(a.categoryId);
    if (a.type === "split") for (const p of a.parts) categoryIds.add(p.categoryId);
    if (a.type === "addTag") tagIds.add(a.tagId);
  }

  if (categoryIds.size > 0) {
    const found = await prisma.category.count({ where: { userId, id: { in: [...categoryIds] } } });
    if (found !== categoryIds.size) throw new UserError("Category not found");
  }
  if (accountIds.size > 0) {
    const found = await prisma.financialAccount.count({ where: { userId, id: { in: [...accountIds] } } });
    if (found !== accountIds.size) throw new UserError("Account not found");
  }
  if (tagIds.size > 0) {
    const found = await prisma.tag.count({ where: { userId, id: { in: [...tagIds] } } });
    if (found !== tagIds.size) throw new UserError("Tag not found");
  }
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

export async function createRuleAction(input: RuleInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const data = ruleSchema.parse(input);
    await assertReferencesOwned(userId, data.conditions, data.actions);
    const last = await prisma.rule.findFirst({ where: { userId }, orderBy: { priority: "desc" } });
    await prisma.rule.create({
      data: {
        userId,
        name: data.name ?? null,
        enabled: data.enabled,
        priority: (last?.priority ?? -1) + 1,
        conditions: data.conditions,
        actions: data.actions,
      },
    });
    revalidatePath("/categories");
  });
}

export async function updateRuleAction(id: string, input: RuleInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const data = ruleSchema.parse(input);
    const existing = await prisma.rule.findFirst({ where: { id, userId } });
    if (!existing) throw new UserError("Rule not found");
    await assertReferencesOwned(userId, data.conditions, data.actions);
    await prisma.rule.update({
      where: { id },
      data: {
        name: data.name ?? null,
        enabled: data.enabled,
        conditions: data.conditions,
        actions: data.actions,
      },
    });
    revalidatePath("/categories");
  });
}

export async function deleteRuleAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const rule = await prisma.rule.findFirst({ where: { id, userId } });
    if (!rule) throw new UserError("Rule not found");
    await prisma.rule.delete({ where: { id } });
    revalidatePath("/categories");
  });
}

export async function setRuleEnabledAction(id: string, enabled: boolean): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const { count } = await prisma.rule.updateMany({ where: { id, userId }, data: { enabled } });
    if (count === 0) throw new UserError("Rule not found");
    revalidatePath("/categories");
  });
}

/** Set priority from the given order (first id = priority 0). */
export async function reorderRulesAction(ids: string[]): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const owned = await prisma.rule.findMany({ where: { userId }, select: { id: true } });
    const ownedIds = new Set(owned.map((r) => r.id));
    if (ids.length !== ownedIds.size || !ids.every((id) => ownedIds.has(id))) {
      throw new UserError("Reorder must include every rule exactly once.");
    }
    await prisma.$transaction(
      ids.map((id, i) => prisma.rule.update({ where: { id }, data: { priority: i } })),
    );
    revalidatePath("/categories");
  });
}

// ── Preview & apply ─────────────────────────────────────────────────────────────

// How far back the preview/backfill look. Keeps the dry run snappy and bounds
// the backfill on large histories.
const LOOKBACK_DAYS = 365;

async function loadRules(userId: string): Promise<RuleLike[]> {
  const rows = await prisma.rule.findMany({ where: { userId }, orderBy: { priority: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    priority: r.priority,
    enabled: r.enabled,
    conditions: r.conditions as unknown as RuleCondition[],
    actions: r.actions as unknown as RuleAction[],
  }));
}

export interface RulePreview {
  ok: true;
  wouldCategorize: number;
  wouldRename: number;
  wouldMarkTransfer: number;
  wouldSplit: number;
  wouldTag: number;
  // A few example rows for the user to sanity-check.
  samples: { description: string; effect: string }[];
}

/** Dry run: report what applying the current rules would do. No writes. */
export async function previewRulesAction(): Promise<RulePreview | { ok: false; error: string }> {
  if (isDemoMode()) {
    return { ok: true, wouldCategorize: 0, wouldRename: 0, wouldMarkTransfer: 0, wouldSplit: 0, wouldTag: 0, samples: [] };
  }
  try {
    const { userId } = await requireUser();
    const rules = await loadRules(userId);
    if (rules.length === 0) {
      return { ok: true, wouldCategorize: 0, wouldRename: 0, wouldMarkTransfer: 0, wouldSplit: 0, wouldTag: 0, samples: [] };
    }

    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
    const txns = await prisma.transaction.findMany({
      where: { userId, deletedAt: null, date: { gte: since } },
      select: {
        description: true,
        amount: true,
        accountId: true,
        type: true,
        categoryId: true,
        tags: { select: { id: true } },
      },
      orderBy: { date: "desc" },
    });

    const liveTagIds = new Set(
      (await prisma.tag.findMany({ where: { userId }, select: { id: true } })).map((t) => t.id),
    );

    let wouldCategorize = 0;
    let wouldRename = 0;
    let wouldMarkTransfer = 0;
    let wouldSplit = 0;
    let wouldTag = 0;
    const samples: { description: string; effect: string }[] = [];

    for (const t of txns) {
      const facts: TxnFacts = {
        description: t.description,
        amountDollars: Number(t.amount),
        accountId: t.accountId,
        type: t.type,
      };
      const effect = evaluateRules(facts, rules);
      const labels: string[] = [];
      // Categorize only counts where we'd actually fill an empty category.
      if (effect.categoryId && t.categoryId == null) {
        wouldCategorize++;
        labels.push("categorize");
      }
      if (effect.description && effect.description !== t.description) {
        wouldRename++;
        labels.push(`rename → "${effect.description}"`);
      }
      if (effect.markTransfer) {
        wouldMarkTransfer++;
        labels.push("mark transfer");
      }
      if (effect.splits) {
        wouldSplit++;
        labels.push("split");
      }
      const newTagIds = (effect.addTagIds ?? []).filter(
        (id) => liveTagIds.has(id) && !t.tags.some((x) => x.id === id),
      );
      if (newTagIds.length > 0) {
        wouldTag++;
        labels.push("tag");
      }
      if (labels.length > 0 && samples.length < 8) {
        samples.push({ description: t.description, effect: labels.join(", ") });
      }
    }

    return { ok: true, wouldCategorize, wouldRename, wouldMarkTransfer, wouldSplit, wouldTag, samples };
  } catch (e) {
    console.error("previewRules failed:", e);
    return { ok: false, error: "Could not preview rules. Please try again." };
  }
}

export interface ApplyResult {
  ok: true;
  categorized: number;
  renamed: number;
  transfersMarked: number;
  split: number;
  tagged: number;
}

/**
 * Run all enabled rules over existing transactions. Never overwrites a category
 * the user set by hand (only fills empty categories). Marked transfers are then
 * paired via matchTransfers. Returns per-effect counts.
 */
export async function applyRulesAction(): Promise<ApplyResult | { ok: false; error: string }> {
  if (isDemoMode()) return { ok: true, categorized: 0, renamed: 0, transfersMarked: 0, split: 0, tagged: 0 };
  try {
    const { userId } = await requireUser();
    const rules = await loadRules(userId);
    if (rules.length === 0) return { ok: true, categorized: 0, renamed: 0, transfersMarked: 0, split: 0, tagged: 0 };

    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
    const txns = await prisma.transaction.findMany({
      where: { userId, deletedAt: null, date: { gte: since } },
      select: {
        id: true,
        description: true,
        amount: true,
        accountId: true,
        type: true,
        categoryId: true,
        isTransfer: true,
        splits: { select: { id: true } },
        tags: { select: { id: true } },
      },
    });

    const liveTagIds = new Set(
      (await prisma.tag.findMany({ where: { userId }, select: { id: true } })).map((t) => t.id),
    );

    let categorized = 0;
    let renamed = 0;
    let transfersMarked = 0;
    let split = 0;
    let tagged = 0;

    for (const t of txns) {
      const facts: TxnFacts = {
        description: t.description,
        amountDollars: Number(t.amount),
        accountId: t.accountId,
        type: t.type,
      };
      const effect = evaluateRules(facts, rules);

      const data: Prisma.TransactionUncheckedUpdateInput = {};

      if (effect.description && effect.description !== t.description) {
        data.description = effect.description;
        renamed++;
      }
      if (effect.markTransfer && !t.isTransfer) {
        data.isTransfer = true;
        transfersMarked++;
      }

      const newTagIds = (effect.addTagIds ?? []).filter(
        (id) => liveTagIds.has(id) && !t.tags.some((x) => x.id === id),
      );

      // A split only applies to a transaction that isn't already split; it
      // takes precedence over a single-category assignment.
      if (effect.splits && t.splits.length === 0) {
        const parts = splitByRatio(toCents(t.amount), effect.splits).filter((p) => p.amountCents > 0);
        if (parts.length > 0) {
          await prisma.$transaction([
            prisma.transaction.update({ where: { id: t.id }, data: { ...data, categoryId: null } }),
            prisma.transactionSplit.createMany({
              data: parts.map((p) => ({ transactionId: t.id, categoryId: p.categoryId, amount: p.amountCents / 100 })),
            }),
          ]);
          split++;
          if (newTagIds.length > 0) {
            await prisma.transaction.update({
              where: { id: t.id },
              data: { tags: { connect: newTagIds.map((id) => ({ id })) } },
            });
            tagged++;
          }
          continue;
        }
      }

      // Fill an empty category only — never clobber a hand-set one.
      if (effect.categoryId && t.categoryId == null) {
        data.categoryId = effect.categoryId;
        categorized++;
      }

      if (newTagIds.length > 0) data.tags = { connect: newTagIds.map((id) => ({ id })) };

      if (Object.keys(data).length > 0) {
        await prisma.transaction.update({ where: { id: t.id }, data });
        if (newTagIds.length > 0) tagged++;
      }
    }

    if (transfersMarked > 0) await matchTransfers(userId);

    revalidatePath("/categories");
    revalidatePath("/transactions");
    revalidatePath("/");
    return { ok: true, categorized, renamed, transfersMarked, split, tagged };
  } catch (e) {
    console.error("applyRules failed:", e);
    return { ok: false, error: "Could not apply rules. Please try again." };
  }
}
