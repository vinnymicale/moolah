"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { parseISODay } from "@/lib/dates";
import { run, UserError, type ActionResult } from "@/lib/action-result";
import { isDemoMode } from "@/lib/demo-guard";
import { normalizeDescription } from "@/lib/recurring-suggestions";
import { flattenAsOf, seriesStart, versionsInclude } from "@/lib/recurring-versions";
import { currentVersion } from "@/lib/recurrence";
import { TxnType, Frequency } from "@/generated/prisma/enums";

const ruleSchema = z.object({
  type: z.enum(TxnType),
  amount: z.coerce.number().positive(),
  description: z.string().min(1).max(120),
  note: z.string().max(500).optional().nullable(),
  accountId: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  frequency: z.enum(Frequency),
  interval: z.coerce.number().int().min(1).max(366).default(1),
  dayOfMonth: z.coerce.number().int().min(1).max(31).optional().nullable(),
  weekday: z.coerce.number().int().min(0).max(6).optional().nullable(),
  startDate: z.string().min(1),
  endDate: z.string().optional().nullable(),
});

export type RecurringInput = z.input<typeof ruleSchema>;

/**
 * How an edit is applied. "forward" writes a new version taking effect on
 * `effectiveFrom`, leaving everything before it as it was. "correct" rewrites a
 * version in place, which is what you want for a typo rather than a real change.
 */
export type EditMode =
  | { mode: "forward"; effectiveFrom: string }
  | { mode: "correct" };

/** The version fields, without the rule-level description. */
function toVersionData(data: z.infer<typeof ruleSchema>) {
  return {
    accountId: data.accountId || null,
    categoryId: data.categoryId || null,
    type: data.type,
    amount: data.amount,
    note: data.note || null,
    frequency: data.frequency,
    interval: data.interval ?? 1,
    dayOfMonth: data.dayOfMonth ?? null,
    weekday: data.weekday ?? null,
    startDate: parseISODay(data.startDate),
    endDate: data.endDate ? parseISODay(data.endDate) : null,
  };
}

export async function createRecurringAction(input: RecurringInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const data = ruleSchema.parse(input);
    const version = toVersionData(data);
    await prisma.recurringRule.create({
      data: {
        userId,
        description: data.description,
        versions: { create: [{ ...version, effectiveFrom: version.startDate }] },
      },
    });
    revalidateAll();
  });
}

export async function updateRecurringAction(
  id: string,
  input: RecurringInput,
  edit: EditMode = { mode: "correct" },
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const existing = await prisma.recurringRule.findFirst({
      where: { id, userId },
      include: versionsInclude,
    });
    if (!existing) throw new UserError("Recurring rule not found");

    const data = ruleSchema.parse(input);
    const version = toVersionData(data);

    if (edit.mode === "forward") {
      const effectiveFrom = parseISODay(edit.effectiveFrom);
      const start = seriesStart(existing);
      if (effectiveFrom.getTime() < start.getTime()) {
        throw new UserError("That date is before this rule started.");
      }
      if (existing.versions.some((v) => v.effectiveFrom.getTime() === effectiveFrom.getTime())) {
        throw new UserError("A change already takes effect on that date.");
      }
      await prisma.$transaction([
        prisma.recurringRule.update({ where: { id }, data: { description: data.description } }),
        prisma.recurringRuleVersion.create({
          data: { ...version, ruleId: id, effectiveFrom, startDate: start },
        }),
      ]);
    } else {
      // A future-dated newest version is the one the user was just looking at,
      // so a correction belongs there rather than on the version in force today.
      const newest = existing.versions[existing.versions.length - 1];
      const target =
        newest.effectiveFrom.getTime() > Date.now()
          ? newest
          : currentVersion(existing.versions, new Date());
      await prisma.$transaction([
        prisma.recurringRule.update({ where: { id }, data: { description: data.description } }),
        prisma.recurringRuleVersion.update({
          where: { id: target.id },
          // startDate belongs to the series, not to this edit.
          data: { ...version, startDate: seriesStart(existing) },
        }),
      ]);
    }
    revalidateAll();
  });
}

/**
 * Undo a scheduled change by dropping one version. A rule always keeps at least
 * one version - deleting the rule is how you get rid of the last one.
 */
export async function deleteRecurringVersionAction(
  ruleId: string,
  versionId: string,
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const rule = await prisma.recurringRule.findFirst({
      where: { id: ruleId, userId },
      include: versionsInclude,
    });
    if (!rule) throw new UserError("Recurring rule not found");
    if (!rule.versions.some((v) => v.id === versionId)) {
      throw new UserError("Version not found");
    }
    if (rule.versions.length === 1) {
      throw new UserError("A rule needs at least one version. Delete the rule instead.");
    }
    await prisma.recurringRuleVersion.delete({ where: { id: versionId } });
    revalidateAll();
  });
}

export async function deleteRecurringAction(id: string, deleteOccurrences = false): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const existing = await prisma.recurringRule.findFirst({ where: { id, userId } });
    if (!existing) throw new UserError("Recurring rule not found");
    if (deleteOccurrences) {
      await prisma.transaction.deleteMany({ where: { userId, recurringRuleId: id } });
    }
    await prisma.recurringRule.delete({ where: { id } });
    revalidateAll();
  });
}

/**
 * Ids of the unlinked candidates whose normalized description matches
 * `normalized`, skipping `excludeId`. Descriptions made entirely of noise (say
 * "POS Debit") normalize to "", which would otherwise match every other such
 * description and sweep up unrelated transactions - an empty key matches nothing.
 */
function matchingCandidateIds(
  candidates: { id: string; description: string }[],
  normalized: string,
  excludeId?: string,
): string[] {
  if (!normalized) return [];
  return candidates
    .filter((t) => t.id !== excludeId && normalizeDescription(t.description) === normalized)
    .map((t) => t.id);
}

/**
 * Link every unlinked transaction of `type` whose normalized description matches
 * `normalized` to `ruleId`, skipping `excludeId`. The normalized grouping isn't
 * expressible in SQL, so candidates are matched in memory. Returns the count.
 */
async function linkMatchingTransactions(
  userId: string,
  type: TxnType,
  normalized: string,
  ruleId: string,
  excludeId?: string,
): Promise<number> {
  const candidates = await prisma.transaction.findMany({
    where: { userId, deletedAt: null, type, recurringRuleId: null },
    select: { id: true, description: true },
  });
  const ids = matchingCandidateIds(candidates, normalized, excludeId);

  if (ids.length > 0) {
    await prisma.transaction.updateMany({
      where: { id: { in: ids }, userId },
      data: { recurringRuleId: ruleId },
    });
  }
  return ids.length;
}

/**
 * Tie a recurring suggestion to an existing rule the user already has. The
 * suggestion's transactions (same type, same normalized description, not yet
 * linked) are attached to the rule, which both records the history and stops the
 * suggestion from coming back - detection skips linked transactions, and their
 * bank descriptions then feed the dedup that hides covered merchants.
 *
 * `suggestionKey` is the detector's group key, "TYPE|normalized description".
 */
export async function linkSuggestionToRuleAction(ruleId: string, suggestionKey: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();

    const rule = await prisma.recurringRule.findFirst({ where: { id: ruleId, userId } });
    if (!rule) throw new UserError("Recurring rule not found");

    const sep = suggestionKey.indexOf("|");
    if (sep < 0) throw new UserError("Invalid suggestion");
    const type = suggestionKey.slice(0, sep);
    const normalized = suggestionKey.slice(sep + 1);
    if ((type !== "INCOME" && type !== "EXPENSE") || !normalized) {
      throw new UserError("Invalid suggestion");
    }

    await linkMatchingTransactions(userId, type as TxnType, normalized, ruleId);
    revalidateAll();
  });
}

/**
 * Tie one transaction to an existing rule, or clear the tie when `ruleId` is
 * null. With `alsoMatching`, the other unlinked transactions sharing its
 * normalized description are swept in too, which is how a merchant the
 * suggestion detector never flagged gets its whole history attached at once.
 *
 * Unlink is always single-transaction: a bulk unlink would be far too easy to
 * fire by accident, so `alsoMatching` is ignored on that path.
 */
export async function linkTransactionToRuleAction(
  transactionId: string,
  ruleId: string | null,
  alsoMatching = false,
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();

    const txn = await prisma.transaction.findFirst({
      where: { id: transactionId, userId, deletedAt: null },
      select: { id: true, type: true, description: true },
    });
    if (!txn) throw new UserError("Transaction not found");

    if (ruleId) {
      const rule = await prisma.recurringRule.findFirst({ where: { id: ruleId, userId } });
      if (!rule) throw new UserError("Recurring rule not found");
    }

    await prisma.transaction.update({
      where: { id: transactionId },
      data: { recurringRuleId: ruleId },
    });

    if (ruleId && alsoMatching) {
      await linkMatchingTransactions(
        userId,
        txn.type,
        normalizeDescription(txn.description),
        ruleId,
        transactionId,
      );
    }

    revalidateAll();
  });
}

export interface LinkableRule {
  id: string;
  description: string;
  frequency: Frequency;
  interval: number;
}

export type LinkOptions =
  | { ok: true; rules: LinkableRule[]; matchCount: number; linked: LinkableRule | null }
  | { ok: false; error: string };

/**
 * What the transaction modal needs to offer a link: the rules of the same type
 * (only those can plausibly be the same series) and how many other unlinked
 * transactions share this description, which labels the "also link N others"
 * checkbox. Both are fetched together because the modal always wants both.
 * `linked` is the rule this transaction already belongs to, returned separately
 * so the modal can name it even when it is archived and thus not pickable.
 */
export async function getTransactionLinkOptionsAction(transactionId: string): Promise<LinkOptions> {
  if (isDemoMode()) return { ok: true, rules: [], matchCount: 0, linked: null };
  try {
    const { userId } = await requireUser();

    const txn = await prisma.transaction.findFirst({
      where: { id: transactionId, userId, deletedAt: null },
      select: { id: true, type: true, description: true, recurringRuleId: true },
    });
    if (!txn) return { ok: false, error: "Transaction not found" };

    const [rules, candidates] = await Promise.all([
      prisma.recurringRule.findMany({
        where: { userId, archived: false, versions: { some: { type: txn.type } } },
        include: versionsInclude,
        orderBy: { createdAt: "asc" },
      }),
      prisma.transaction.findMany({
        where: { userId, deletedAt: null, type: txn.type, recurringRuleId: null },
        select: { id: true, description: true },
      }),
    ]);

    const normalized = normalizeDescription(txn.description);
    const matchCount = matchingCandidateIds(candidates, normalized, transactionId).length;

    // The frequency shown is the one in force today, which is what the picker
    // labels a rule with.
    const toLinkable = (r: (typeof rules)[number]): LinkableRule => {
      const active = flattenAsOf(r, new Date());
      return {
        id: r.id,
        description: r.description,
        frequency: active.frequency,
        interval: active.interval,
      };
    };

    // Usually already in `rules`; fetched only when it isn't (archived, or a
    // rule whose type no longer matches the transaction's).
    let linked = txn.recurringRuleId ? rules.find((r) => r.id === txn.recurringRuleId) ?? null : null;
    if (txn.recurringRuleId && !linked) {
      linked = await prisma.recurringRule.findFirst({
        where: { id: txn.recurringRuleId, userId },
        include: versionsInclude,
      });
    }

    return {
      ok: true,
      rules: rules.map(toLinkable),
      matchCount,
      linked: linked ? toLinkable(linked) : null,
    };
  } catch (e) {
    console.error("Action failed:", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/recurring");
  revalidatePath("/transactions");
}
