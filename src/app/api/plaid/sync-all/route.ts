import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { syncPlaidItem } from "@/lib/plaid-sync";

// "Sync on visit" throttle: only re-sync an item that hasn't synced within this
// window, so opening (or reloading) the app repeatedly doesn't hammer Plaid.
// Tune to taste - bank data rarely changes more than a few times a day.
const STALE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Syncs every linked bank for the signed-in user that is "stale" (never
 * synced, or last synced longer ago than STALE_MS). Best-effort: one item
 * failing doesn't stop the others. Called in the background from the app on
 * load - see AutoPlaidSync.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cutoff = new Date(Date.now() - STALE_MS);
  const items = await prisma.plaidItem.findMany({
    where: {
      userId: session.user.id,
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: cutoff } }],
    },
    select: { id: true },
  });

  let synced = 0;
  let failed = 0;
  const totals = { added: 0, modified: 0, removed: 0, balancesUpdated: 0 };

  for (const { id } of items) {
    try {
      const r = await syncPlaidItem(id);
      synced++;
      totals.added += r.added;
      totals.modified += r.modified;
      totals.removed += r.removed;
      totals.balancesUpdated += r.balancesUpdated;
    } catch (e: unknown) {
      failed++;
      const msg = e instanceof Error ? e.message : "Sync failed";
      console.error(`Plaid sync-all error for item ${id}:`, e);
      await prisma.plaidItem.update({ where: { id }, data: { error: msg } }).catch(() => {});
    }
  }

  const changed = totals.added + totals.modified + totals.removed + totals.balancesUpdated;
  return NextResponse.json({ ok: true, synced, failed, changed, ...totals });
}
