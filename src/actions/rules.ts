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
      // A mismatch means the caller's rule list is stale - another client added or
      // deleted a rule. Revalidate so the caller's refresh gets the real list back
      // instead of its own cached copy, which would leave it stuck on stale rows.
      revalidatePath("/categories");
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

// How many changed rows the preview lists in full. The rest are counted.
const SAMPLE_LIMIT = 8;

async function loadRules(userId: string, ruleId?: string): Promise<RuleLike[]> {
  const rows = await prisma.rule.findMany({
    where: { userId, ...(ruleId ? { id: ruleId } : {}) },
    orderBy: { priority: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    priority: r.priority,
    enabled: r.enabled,
    conditions: r.conditions as unknown as RuleCondition[],
    actions: r.actions as unknown as RuleAction[],
  }));
}

// A single-rule run still has to respect the enabled flag, but a disabled rule
// the user explicitly asked to run is a no-op rather than an error, matching
// what "apply all" does with it.
async function loadRulesForRun(userId: string, ruleId?: string): Promise<RuleLike[]> {
  if (!ruleId) return loadRules(userId);
  const rules = await loadRules(userId, ruleId);
  if (rules.length === 0) throw new UserError("Rule not found");
  return rules;
}

/** One field a rule would change on a sample row, with both sides shown. */
export interface PreviewChange {
  field: string;
  /** Current value, or null where the row has nothing there yet. */
  before: string | null;
  after: string;
}

export interface PreviewSample {
  description: string;
  date: string;
  amount: number;
  changes: PreviewChange[];
}

export interface RulePreview {
  ok: true;
  wouldCategorize: number;
  wouldRename: number;
  wouldMarkTransfer: number;
  wouldSplit: number;
  wouldTag: number;
  // A few example rows for the user to sanity-check.
  samples: PreviewSample[];
  /** Rows that would change beyond the ones listed in `samples`. */
  moreSamples: number;
}

/**
 * "Groceries 60% / Household 40%". Ratios are relative rather than normalized,
 * so they get divided by their own total before being shown as percentages.
 */
function splitLabel(parts: { categoryId: string; ratio: number }[], names: Map<string, string>): string {
  const total = parts.reduce((sum, p) => sum + p.ratio, 0);
  return parts
    .map((p) => {
      const pct = total > 0 ? Math.round((p.ratio / total) * 100) : 0;
      return `${names.get(p.categoryId) ?? "Unknown"} ${pct}%`;
    })
    .join(" / ");
}

/**
 * Dry run: report what applying the rules would do. No writes. Pass a ruleId to
 * scope the run to that one rule instead of the whole list.
 */
export async function previewRulesAction(ruleId?: string): Promise<RulePreview | { ok: false; error: string }> {
  if (isDemoMode()) {
    return { ok: true, wouldCategorize: 0, wouldRename: 0, wouldMarkTransfer: 0, wouldSplit: 0, wouldTag: 0, samples: [], moreSamples: 0 };
  }
  try {
    const { userId } = await requireUser();
    const rules = await loadRulesForRun(userId, ruleId);
    if (rules.length === 0) {
      return { ok: true, wouldCategorize: 0, wouldRename: 0, wouldMarkTransfer: 0, wouldSplit: 0, wouldTag: 0, samples: [], moreSamples: 0 };
    }

    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
    const txns = await prisma.transaction.findMany({
      where: { userId, deletedAt: null, date: { gte: since } },
      select: {
        description: true,
        date: true,
        amount: true,
        accountId: true,
        type: true,
        categoryId: true,
        isTransfer: true,
        category: { select: { name: true } },
        tags: { select: { id: true, name: true } },
      },
      orderBy: { date: "desc" },
    });

    // Names, not just ids: the preview shows what a change reads as, and a rule
    // can point at a category or tag that no longer exists.
    const [liveTags, liveCategories] = await Promise.all([
      prisma.tag.findMany({ where: { userId }, select: { id: true, name: true } }),
      prisma.category.findMany({ where: { userId }, select: { id: true, name: true } }),
    ]);
    const tagNames = new Map(liveTags.map((t) => [t.id, t.name]));
    const categoryNames = new Map(liveCategories.map((c) => [c.id, c.name]));

    let wouldCategorize = 0;
    let wouldRename = 0;
    let wouldMarkTransfer = 0;
    let wouldSplit = 0;
    let wouldTag = 0;
    const samples: PreviewSample[] = [];
    let changedRows = 0;

    for (const t of txns) {
      const facts: TxnFacts = {
        description: t.description,
        amountDollars: Number(t.amount),
        accountId: t.accountId,
        type: t.type,
      };
      const effect = evaluateRules(facts, rules);
      const changes: PreviewChange[] = [];
      // Categorize only counts where we'd actually fill an empty category.
      if (effect.categoryId && t.categoryId == null) {
        wouldCategorize++;
        changes.push({
          field: "Category",
          before: t.category?.name ?? null,
          after: categoryNames.get(effect.categoryId) ?? "Unknown category",
        });
      }
      if (effect.description && effect.description !== t.description) {
        wouldRename++;
        changes.push({ field: "Description", before: t.description, after: effect.description });
      }
      if (effect.markTransfer && !t.isTransfer) {
        wouldMarkTransfer++;
        changes.push({ field: "Transfer", before: "No", after: "Yes" });
      }
      if (effect.splits) {
        wouldSplit++;
        changes.push({
          field: "Split",
          before: t.category?.name ?? null,
          after: splitLabel(effect.splits, categoryNames),
        });
      }
      const newTagIds = (effect.addTagIds ?? []).filter(
        (id) => tagNames.has(id) && !t.tags.some((x) => x.id === id),
      );
      if (newTagIds.length > 0) {
        wouldTag++;
        const added = newTagIds.map((id) => tagNames.get(id)!);
        changes.push({
          field: "Tags",
          before: t.tags.length > 0 ? t.tags.map((x) => x.name).join(", ") : null,
          after: [...t.tags.map((x) => x.name), ...added].join(", "),
        });
      }
      if (changes.length > 0) {
        changedRows++;
        if (samples.length < SAMPLE_LIMIT) {
          samples.push({
            description: t.description,
            date: t.date.toISOString().slice(0, 10),
            amount: Number(t.amount),
            changes,
          });
        }
      }
    }

    return {
      ok: true,
      wouldCategorize,
      wouldRename,
      wouldMarkTransfer,
      wouldSplit,
      wouldTag,
      samples,
      moreSamples: Math.max(0, changedRows - samples.length),
    };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
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
  /** Set when the run changed something, so the UI can offer an undo. */
  runId?: string;
}

const EMPTY_APPLY: ApplyResult = {
  ok: true,
  categorized: 0,
  renamed: 0,
  transfersMarked: 0,
  split: 0,
  tagged: 0,
};

// The prior state of one transaction, captured before the run writes over it.
// Only the fields this run is about to change are recorded, so undo restores
// exactly what it took and leaves everything else alone.
type PriorState = {
  transactionId: string;
  hadDescription: boolean;
  prevDescription: string | null;
  hadCategory: boolean;
  prevCategoryId: string | null;
  hadTransfer: boolean;
  prevIsTransfer: boolean | null;
  prevTransferPeerId: string | null;
  createdSplits: boolean;
  addedTagIds: string[];
};

/**
 * Run enabled rules over existing transactions - all of them, or just `ruleId`
 * when the user applies a single row. Never overwrites a category the user set
 * by hand (only fills empty categories). Marked transfers are then paired via
 * matchTransfers. Returns per-effect counts plus a run id to undo with.
 */
export async function applyRulesAction(ruleId?: string): Promise<ApplyResult | { ok: false; error: string }> {
  if (isDemoMode()) return EMPTY_APPLY;
  try {
    const { userId } = await requireUser();
    const rules = await loadRulesForRun(userId, ruleId);
    if (rules.length === 0) return EMPTY_APPLY;

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
        transferPeerId: true,
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
    const priors: PriorState[] = [];

    for (const t of txns) {
      const facts: TxnFacts = {
        description: t.description,
        amountDollars: Number(t.amount),
        accountId: t.accountId,
        type: t.type,
      };
      const effect = evaluateRules(facts, rules);

      const data: Prisma.TransactionUncheckedUpdateInput = {};
      const prior: PriorState = {
        transactionId: t.id,
        hadDescription: false,
        prevDescription: null,
        hadCategory: false,
        prevCategoryId: null,
        hadTransfer: false,
        prevIsTransfer: null,
        prevTransferPeerId: null,
        createdSplits: false,
        addedTagIds: [],
      };

      if (effect.description && effect.description !== t.description) {
        data.description = effect.description;
        prior.hadDescription = true;
        prior.prevDescription = t.description;
        renamed++;
      }
      if (effect.markTransfer && !t.isTransfer) {
        data.isTransfer = true;
        prior.hadTransfer = true;
        prior.prevIsTransfer = t.isTransfer;
        prior.prevTransferPeerId = t.transferPeerId;
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
          prior.createdSplits = true;
          prior.hadCategory = true;
          prior.prevCategoryId = t.categoryId;
          split++;
          if (newTagIds.length > 0) {
            await prisma.transaction.update({
              where: { id: t.id },
              data: { tags: { connect: newTagIds.map((id) => ({ id })) } },
            });
            prior.addedTagIds = newTagIds;
            tagged++;
          }
          priors.push(prior);
          continue;
        }
      }

      // Fill an empty category only — never clobber a hand-set one.
      if (effect.categoryId && t.categoryId == null) {
        data.categoryId = effect.categoryId;
        prior.hadCategory = true;
        prior.prevCategoryId = null;
        categorized++;
      }

      if (newTagIds.length > 0) data.tags = { connect: newTagIds.map((id) => ({ id })) };

      if (Object.keys(data).length > 0) {
        await prisma.transaction.update({ where: { id: t.id }, data });
        if (newTagIds.length > 0) {
          prior.addedTagIds = newTagIds;
          tagged++;
        }
        priors.push(prior);
      }
    }

    if (transfersMarked > 0) {
      // Pairing writes transferPeerId on the rows it links. The before-value
      // is already captured in prevTransferPeerId, so undo restores it.
      await matchTransfers(userId);
    }

    let runId: string | undefined;
    if (priors.length > 0) {
      const run = await prisma.ruleRun.create({
        data: {
          userId,
          ruleId: ruleId ?? null,
          changes: { create: priors.map(({ transactionId, ...rest }) => ({ transactionId, ...rest })) },
        },
        select: { id: true },
      });
      runId = run.id;
    }

    revalidatePath("/categories");
    revalidatePath("/transactions");
    revalidatePath("/");
    return { ok: true, categorized, renamed, transfersMarked, split, tagged, runId };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error("applyRules failed:", e);
    return { ok: false, error: "Could not apply rules. Please try again." };
  }
}

/**
 * Restore every transaction a run changed to the state it had before. Fields
 * the run never touched are left alone, so an edit made since the run to an
 * untouched field survives. Undoing is itself recorded (undoneAt) so the same
 * run can't be replayed backwards twice.
 */
export async function undoRuleRunAction(runId: string): Promise<ActionResult> {
  return run(async () => {
    if (isDemoMode()) throw new UserError("This is a read-only demo. Changes are disabled.");
    const { userId } = await requireUser();

    const ruleRun = await prisma.ruleRun.findFirst({
      where: { id: runId, userId },
      include: { changes: true },
    });
    if (!ruleRun) throw new UserError("That run is no longer available.");
    if (ruleRun.undoneAt) throw new UserError("That run was already undone.");

    for (const c of ruleRun.changes) {
      const data: Prisma.TransactionUncheckedUpdateInput = {};
      if (c.hadDescription && c.prevDescription !== null) data.description = c.prevDescription;
      if (c.hadCategory) data.categoryId = c.prevCategoryId;
      if (c.hadTransfer) {
        data.isTransfer = c.prevIsTransfer ?? false;
        data.transferPeerId = c.prevTransferPeerId;
      }
      if (c.addedTagIds.length > 0) {
        data.tags = { disconnect: c.addedTagIds.map((id) => ({ id })) };
      }

      // Ownership is checked up front so every write below can address the row
      // by id: a tampered runId can't reach another user's transactions.
      const owned = await prisma.transaction.findFirst({
        where: { id: c.transactionId, userId },
        select: { id: true },
      });
      if (!owned) continue;

      if (c.createdSplits) {
        await prisma.transactionSplit.deleteMany({ where: { transactionId: c.transactionId } });
      }
      if (Object.keys(data).length > 0) {
        await prisma.transaction.update({ where: { id: c.transactionId }, data });
      }
    }

    await prisma.ruleRun.update({ where: { id: ruleRun.id }, data: { undoneAt: new Date() } });

    revalidatePath("/categories");
    revalidatePath("/transactions");
    revalidatePath("/");
  });
}
