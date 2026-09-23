import { NextResponse } from "next/server";
import { householdForRoute } from "@/lib/household";
import { prisma } from "@/lib/prisma";
import { syncPlaidItem } from "@/lib/plaid-sync";

/**
 * Re-pull the full transaction history for every bank the signed-in user has
 * ALREADY linked. This operates only on stored Plaid items via their existing
 * access tokens - it never opens Plaid Link, so it cannot add a new connection.
 *
 * Uses recategorizeOnly, which re-fetches all history from the start without
 * advancing the item's saved cursor. Transactions are matched on
 * plaidTransactionId (upsert), so existing rows are updated in place and only
 * genuinely missing charges - e.g. one that was deleted from our DB - get
 * re-created. Nothing is duplicated.
 */
export async function POST() {
  const { ctx, response } = await householdForRoute("RUN_SYNC");
  if (response) return response;
  const { householdId } = ctx;

  const items = await prisma.plaidItem.findMany({ where: { householdId }, select: { id: true } });

  let synced = 0;
  let failed = 0;
  const totals = { added: 0, modified: 0, removed: 0, balancesUpdated: 0 };

  for (const { id } of items) {
    try {
      const r = await syncPlaidItem(id, householdId, { recategorizeOnly: true });
      synced++;
      totals.added += r.added;
      totals.modified += r.modified;
      totals.removed += r.removed;
      totals.balancesUpdated += r.balancesUpdated;
    } catch (e: unknown) {
      failed++;
      const msg = e instanceof Error ? e.message : "Re-import failed";
      console.error(`Plaid reimport-all error for item ${id}:`, e);
      await prisma.plaidItem.update({ where: { id }, data: { error: msg } }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, items: items.length, synced, failed, ...totals });
}
