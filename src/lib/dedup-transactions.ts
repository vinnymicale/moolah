import { prisma } from "@/lib/prisma";

export type DuplicateGroup = {
  // The transaction we keep (the oldest copy).
  keepId: string;
  // The newer copies to remove.
  removeIds: string[];
  date: string;
  amount: number;
  description: string;
  type: string;
  accountName: string | null;
};

export type DedupScan = {
  groups: DuplicateGroup[];
  removableCount: number;
};

/**
 * Find Plaid-sourced transactions that share the same account, date, amount,
 * type, and description but exist as more than one non-deleted row - the
 * signature of a re-import that re-created charges Plaid handed back under a
 * fresh transaction_id. The oldest row in each group is kept; the rest are
 * reported as removable.
 *
 * Groups the user has accepted as legitimate are skipped, but only while every
 * row in them stays flagged: a third copy of an accepted pair arrives unflagged
 * and puts the group back in the list.
 *
 * This is content-based, so it works even when the duplicates carry different
 * plaidTransactionIds (the exact case the cursor-reset re-import produced).
 */
export async function scanDuplicateTransactions(householdId: string): Promise<DedupScan> {
  const rows = await prisma.transaction.findMany({
    where: { householdId, deletedAt: null, plaidTransactionId: { not: null } },
    select: {
      id: true,
      accountId: true,
      date: true,
      amount: true,
      description: true,
      type: true,
      createdAt: true,
      dedupIgnored: true,
      account: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const byKey = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = [r.accountId, r.date.toISOString().slice(0, 10), String(r.amount), r.type, r.description].join(" ");
    const list = byKey.get(key);
    if (list) list.push(r);
    else byKey.set(key, [r]);
  }

  const groups: DuplicateGroup[] = [];
  let removableCount = 0;
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    // Accepted as legitimate - and still exactly the set that was accepted, so
    // nothing new has shown up since.
    if (list.every((r) => r.dedupIgnored)) continue;
    // list is createdAt-ascending, so [0] is the original we keep.
    const [keep, ...rest] = list;
    removableCount += rest.length;
    groups.push({
      keepId: keep.id,
      removeIds: rest.map((r) => r.id),
      date: keep.date.toISOString().slice(0, 10),
      amount: Number(keep.amount),
      description: keep.description,
      type: keep.type,
      accountName: keep.account?.name ?? null,
    });
  }

  // Most-recent dates first, so the review list reads like a statement.
  groups.sort((a, b) => b.date.localeCompare(a.date));
  return { groups, removableCount };
}

/**
 * Mark a duplicate group as legitimate so it stops being reported. Flags every
 * row in the group - the kept copy and the ones the scan offered to remove -
 * because the scan only suppresses a group whose rows are all flagged.
 * `ids` is a group's keepId plus its removeIds.
 */
export async function ignoreDuplicateGroup(householdId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await prisma.transaction.updateMany({
    where: { id: { in: ids }, householdId },
    data: { dedupIgnored: true },
  });
  return res.count;
}

/**
 * Remove duplicate copies found by scanDuplicateTransactions, keeping the
 * oldest row in each group. `mode` chooses soft (move to trash) or hard
 * (permanent) deletion. `keepIds` selects which groups to act on - only groups
 * whose keepId is listed are touched, so the caller can act on a subset the
 * user checked. Returns the number of rows removed.
 */
export async function removeDuplicateTransactions(
  householdId: string,
  mode: "soft" | "hard",
  keepIds: string[],
): Promise<number> {
  const { groups } = await scanDuplicateTransactions(householdId);
  const selected = new Set(keepIds);
  const ids = groups.filter((g) => selected.has(g.keepId)).flatMap((g) => g.removeIds);
  if (ids.length === 0) return 0;

  if (mode === "hard") {
    const res = await prisma.transaction.deleteMany({ where: { id: { in: ids }, householdId } });
    return res.count;
  }
  const res = await prisma.transaction.updateMany({
    where: { id: { in: ids }, householdId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return res.count;
}
