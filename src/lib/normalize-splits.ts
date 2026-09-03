// Split normalization. Split out from splits.ts because it touches Prisma, and
// splits.ts is imported by client components: pulling the database client into
// that module drags pg (and node:net, node:tls, node:dns) into the browser
// bundle and the build fails.
//
// It lives in lib rather than the actions module because every export of a
// "use server" file is a callable endpoint, and this one takes userId from its
// caller. Keeping it here means the only way to reach it is through an action
// that has already authenticated.

import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/action-result";
import { TxnType } from "@/generated/prisma/enums";
import { validateSplits } from "@/lib/splits";

export interface NormalizedSplit {
  categoryId: string | null;
  amount: number;
}

/**
 * Validate split parts against the transaction total and confirm every split
 * category belongs to the user and matches the transaction's kind (an EXPENSE
 * can only split across expense categories, etc. - mirroring what the form
 * offers). Returns the cleaned splits, or [] when no real split was provided
 * (a single part or none means "not split").
 */
export async function normalizeSplits(
  userId: string,
  type: TxnType,
  total: number,
  splits?: { categoryId?: string | null; amount: number }[] | null,
): Promise<NormalizedSplit[]> {
  if (!splits || splits.length < 2) return [];
  const cleaned: NormalizedSplit[] = splits.map((s) => ({ categoryId: s.categoryId || null, amount: s.amount }));
  const err = validateSplits(total, cleaned);
  if (err) throw new UserError(err);
  const catIds = [...new Set(cleaned.map((s) => s.categoryId).filter((id): id is string => !!id))];
  if (catIds.length > 0) {
    const found = await prisma.category.count({ where: { id: { in: catIds }, userId, kind: type } });
    if (found !== catIds.length) throw new UserError("Split category not found");
  }
  return cleaned;
}
