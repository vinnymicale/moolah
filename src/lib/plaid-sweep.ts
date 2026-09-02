// Shared "sync the stale banks" logic, used by both the on-visit HTTP route
// (/api/plaid/sync-all, driven by AutoPlaidSync) and the background scheduler
// (src/lib/plaid-scheduler.ts). Keeping one implementation means the two paths
// can't drift on staleness, backoff, or error handling.

import { prisma } from "@/lib/prisma";
import { syncPlaidItem } from "@/lib/plaid-sync";

// Only re-sync an item that hasn't synced within this window, so opening (or
// reloading) the app repeatedly doesn't hammer Plaid. Bank data rarely changes
// more than a few times a day.
export const STALE_MS = Number(process.env.PLAID_STALE_MS ?? 60 * 60 * 1000);

// After this many consecutive failures an item is only retried on the slower
// backoff schedule below, so a permanently broken connection (revoked login,
// closed account) doesn't get hammered every sweep or spam the sync-failing
// notification trigger. A manual/forced sync always ignores this.
export const FAILURE_BACKOFF_THRESHOLD = 3;
const BACKOFF_MS = 6 * 60 * 60 * 1000; // 6 hours

export type SweepTotals = {
  synced: number;
  failed: number;
  added: number;
  modified: number;
  removed: number;
  balancesUpdated: number;
};

function emptyTotals(): SweepTotals {
  return { synced: 0, failed: 0, added: 0, modified: 0, removed: 0, balancesUpdated: 0 };
}

/**
 * Pick the items due for a sync. `userId` scopes to one user (the HTTP path);
 * omit it to sweep every user's items (the scheduler). `force` takes everything
 * for that scope regardless of staleness or backoff.
 */
export async function findDueItems(opts: {
  userId?: string;
  force?: boolean;
  now?: Date;
}): Promise<{ id: string; userId: string }[]> {
  const now = opts.now ?? new Date();
  const select = { id: true, userId: true } as const;

  if (opts.force) {
    return prisma.plaidItem.findMany({
      where: { ...(opts.userId ? { userId: opts.userId } : {}) },
      select,
    });
  }

  const stale = { lt: new Date(now.getTime() - STALE_MS) };
  const backoff = { lt: new Date(now.getTime() - BACKOFF_MS) };

  return prisma.plaidItem.findMany({
    where: {
      ...(opts.userId ? { userId: opts.userId } : {}),
      OR: [
        // Never synced - always due.
        { lastSyncedAt: null },
        // Healthy enough to run on the normal staleness window.
        { failureCount: { lt: FAILURE_BACKOFF_THRESHOLD }, lastSyncedAt: stale },
        // Repeatedly failing - retry, but only on the slower window.
        { failureCount: { gte: FAILURE_BACKOFF_THRESHOLD }, lastSyncedAt: backoff },
      ],
    },
    select,
  });
}

/**
 * Sync the given items one at a time, best-effort: one item failing doesn't
 * stop the others. A failure records the message and bumps failureCount so
 * findDueItems can back off; syncPlaidItem resets both on success.
 */
export async function syncItems(items: { id: string; userId: string }[]): Promise<SweepTotals> {
  const totals = emptyTotals();

  for (const { id, userId } of items) {
    try {
      const r = await syncPlaidItem(id, userId);
      totals.synced++;
      totals.added += r.added;
      totals.modified += r.modified;
      totals.removed += r.removed;
      totals.balancesUpdated += r.balancesUpdated;
    } catch (e: unknown) {
      totals.failed++;
      const msg = e instanceof Error ? e.message : "Sync failed";
      console.error(`Plaid sync error for item ${id}:`, e);
      await prisma.plaidItem
        .update({
          where: { id },
          data: { error: msg, failureCount: { increment: 1 }, lastSyncedAt: new Date() },
        })
        .catch(() => {});
    }
  }

  return totals;
}

/** Convenience: find the due items for a scope and sync them. */
export async function sweepPlaid(opts: {
  userId?: string;
  force?: boolean;
  now?: Date;
}): Promise<SweepTotals> {
  return syncItems(await findDueItems(opts));
}

/** Total rows actually touched, for "did anything change?" callers. */
export function changedCount(t: SweepTotals): number {
  return t.added + t.modified + t.removed + t.balancesUpdated;
}
