// Background Plaid sync. On a long-lived server (self-hosted Docker /
// `npm start`) this keeps transactions and balances current without anyone
// having a browser open, so notification rules have fresh data to fire on and
// the app doesn't spend the first few seconds of a visit fetching.
//
// This only makes sense where one Node process stays alive. It's a no-op on
// serverless, and guarded against double-registration (Next can evaluate a
// module more than once). The boot entry point is src/instrumentation.ts.
//
// A future Plaid webhook (see the README roadmap) would make this the fallback
// rather than the primary path, but it stays either way: webhooks are
// fire-and-forget, and a home server that was down when one fired would
// otherwise never learn about those transactions.

import cron, { type ScheduledTask } from "node-cron";
import { changedCount, sweepPlaid } from "./plaid-sweep";

const SCHEDULE = process.env.PLAID_SYNC_CRON ?? "*/30 * * * *";

let started = false;
let task: ScheduledTask | null = null;
// Guards against a slow sweep overlapping the next tick and double-syncing an
// item. A skipped tick is harmless - the next one picks the work up.
let running = false;

export async function startPlaidSyncScheduler(): Promise<void> {
  if (started) return;
  if (!cron.validate(SCHEDULE)) {
    console.warn(`[plaid] invalid PLAID_SYNC_CRON "${SCHEDULE}"; background sync not scheduled`);
    return;
  }
  started = true;

  task = cron.schedule(SCHEDULE, async () => {
    try {
      await sweep();
    } catch (e) {
      // Never let a sweep failure take the timer down.
      console.error("[plaid] background sync failed:", e);
    }
  });
  console.log(`[plaid] background sync scheduled (${SCHEDULE})`);
}

/** One pass over every user's due items. Exported for tests and manual runs. */
export async function sweep(): Promise<void> {
  if (running) {
    console.warn("[plaid] previous sweep still running; skipping this tick");
    return;
  }
  running = true;
  try {
    const totals = await sweepPlaid({});
    if (totals.synced > 0 || totals.failed > 0) {
      console.log(
        `[plaid] background sync: ${totals.synced} item(s) synced, ${totals.failed} failed, ` +
          `${changedCount(totals)} row(s) changed`,
      );
    }
  } finally {
    running = false;
  }
}

export function _resetSchedulerForTests(): void {
  void task?.stop();
  task = null;
  started = false;
  running = false;
}
