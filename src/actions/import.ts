"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { parseISODay, isoDay } from "@/lib/dates";
import { toCents } from "@/lib/money";
import { expandOccurrences } from "@/lib/recurrence";
import { guessCategoryName, type ImportType } from "@/lib/csv-import";
import { matchCategoryRule } from "@/lib/category-rules";
import { matchTransfers } from "@/lib/plaid-sync";
import { run, UserError, type ActionResult } from "@/lib/action-result";
import { isDemoMode } from "@/lib/demo-guard";
import { TxnType } from "@/generated/prisma/enums";

const parsedRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(200),
  amount: z.number().positive(),
  type: z.enum(["INCOME", "EXPENSE"]),
});

export type ParsedRowInput = z.infer<typeof parsedRowSchema>;

export interface AnalyzedRow extends ParsedRowInput {
  /** True when an equivalent transaction already exists (manual or recurring). */
  duplicate: boolean;
  duplicateReason: string | null;
  /** Suggested category id for the household, if a keyword matched. */
  suggestedCategoryId: string | null;
}

/** Stable key for matching by direction + day + amount. */
function key(type: ImportType | TxnType, dateISO: string, cents: number): string {
  return `${type}|${dateISO}|${cents}`;
}

/**
 * Annotate parsed rows with duplicate detection (against existing concrete
 * transactions and projected recurring occurrences) and a suggested category.
 * Pure read - does not write anything.
 */
export async function analyzeImportAction(
  rowsInput: ParsedRowInput[],
): Promise<{ ok: true; rows: AnalyzedRow[] } | { ok: false; error: string }> {
  try {
    const { householdId } = await requireHousehold();
    const rows = z.array(parsedRowSchema).max(5000).parse(rowsInput);
    if (rows.length === 0) return { ok: true, rows: [] };

    const dates = rows.map((r) => r.date).sort();
    const minISO = dates[0];
    const maxISO = dates[dates.length - 1];
    const rangeStart = parseISODay(minISO);
    const rangeEnd = parseISODay(maxISO);

    // Existing concrete transactions in range, counted as a multiset so we only
    // flag as many CSV rows as there are real matches.
    const existing = await prisma.transaction.findMany({
      where: { householdId, date: { gte: rangeStart, lte: rangeEnd } },
      select: { type: true, date: true, amount: true },
    });
    const existingCounts = new Map<string, number>();
    for (const t of existing) {
      const k = key(t.type, isoDay(t.date), toCents(t.amount));
      existingCounts.set(k, (existingCounts.get(k) ?? 0) + 1);
    }

    // Projected recurring occurrences in range (a rule yields at most one per
    // day, so a set is enough).
    const rules = await prisma.recurringRule.findMany({
      where: { householdId, archived: false },
    });
    const recurringKeys = new Set<string>();
    for (const rule of rules) {
      const occ = expandOccurrences(
        {
          frequency: rule.frequency,
          interval: rule.interval,
          startDate: rule.startDate,
          endDate: rule.endDate,
          dayOfMonth: rule.dayOfMonth,
          weekday: rule.weekday,
        },
        rangeStart,
        rangeEnd,
      );
      const cents = toCents(rule.amount);
      for (const d of occ) recurringKeys.add(key(rule.type, isoDay(d), cents));
    }

    // Category lookup by (name, kind).
    const categories = await prisma.category.findMany({
      where: { householdId },
      select: { id: true, name: true, kind: true },
    });
    const catByName = new Map(categories.map((c) => [`${c.kind}|${c.name.toLowerCase()}`, c.id]));

    // User-defined rules beat the built-in keyword guesser.
    const categoryRules = await prisma.categoryRule.findMany({ where: { householdId } });

    const analyzed: AnalyzedRow[] = rows.map((r) => {
      const cents = toCents(r.amount);
      const k = key(r.type, r.date, cents);

      let duplicate = false;
      let duplicateReason: string | null = null;
      const remaining = existingCounts.get(k) ?? 0;
      if (remaining > 0) {
        existingCounts.set(k, remaining - 1);
        duplicate = true;
        duplicateReason = "Already recorded";
      } else if (recurringKeys.has(k)) {
        duplicate = true;
        duplicateReason = "Matches a recurring rule";
      }

      const guessedName = guessCategoryName(r.description, r.type);
      const suggestedCategoryId =
        matchCategoryRule(r.description, categoryRules) ??
        (guessedName ? catByName.get(`${r.type}|${guessedName.toLowerCase()}`) ?? null : null);

      return { ...r, duplicate, duplicateReason, suggestedCategoryId };
    });

    return { ok: true, rows: analyzed };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid rows." };
    return { ok: false, error: e instanceof Error ? e.message : "Could not analyze the file." };
  }
}

const commitRowSchema = parsedRowSchema.extend({
  categoryId: z.string().nullable().optional(),
});

const commitSchema = z.object({
  rows: z.array(commitRowSchema).min(1).max(5000),
  accountId: z.string().nullable().optional(),
});

export type CommitImportInput = z.input<typeof commitSchema>;

/** Create concrete (cleared) transactions for the approved rows. */
export async function commitImportAction(input: CommitImportInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId, userId } = await requireHousehold();
    const { rows, accountId } = commitSchema.parse(input);

    if (accountId) {
      const acct = await prisma.financialAccount.findFirst({ where: { id: accountId, householdId } });
      if (!acct) throw new UserError("Account not found");
    }

    // Resolve which provided category ids actually belong to the household.
    const provided = [...new Set(rows.map((r) => r.categoryId).filter((c): c is string => !!c))];
    const validCatIds = new Set(
      provided.length
        ? (await prisma.category.findMany({ where: { householdId, id: { in: provided } }, select: { id: true } })).map((c) => c.id)
        : [],
    );

    await prisma.transaction.createMany({
      data: rows.map((r) => ({
        householdId,
        accountId: accountId || null,
        categoryId: r.categoryId && validCatIds.has(r.categoryId) ? r.categoryId : null,
        createdById: userId,
        type: r.type as TxnType,
        amount: r.amount,
        date: parseISODay(r.date),
        description: r.description,
        cleared: true,
      })),
    });

    // Imported CC payments pair up the same way Plaid-synced ones do.
    await matchTransfers(householdId);

    revalidatePath("/");
    revalidatePath("/calendar");
    revalidatePath("/transactions");
    revalidatePath("/trends");
  });
}
